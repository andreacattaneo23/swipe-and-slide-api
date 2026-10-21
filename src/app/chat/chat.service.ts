import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { DATABASE, type Database, type Executor } from '../../infra/database/database';
import { RateLimiter } from '../../infra/cache/rate-limiter';
import { ApiError } from '../../infra/http/api-error';
import { ChatCryptoService } from '../../domain/chat-crypto/chat-crypto.service';
import { NotificationsService } from '../../domain/notifications/notifications.service';
import { RealtimePublisher } from '../../domain/realtime/realtime-publisher';
import { FeedChatError } from '../feed-chat/feed-chat.errors';
import { PeopleService } from '../feed-chat/people.service';
import {
  MESSAGE_MAX_LENGTH,
  type MessageDto,
  type MessagesDto,
  type SentMessageDto,
} from './chat.dto';

type MessageRow = {
  id: string;
  sender_id: string;
  client_message_id: string;
  ciphertext: Buffer;
  nonce: Buffer;
  created_at: Date;
  read_at: Date | null;
};

/** Testo della chat: solo testo ed emoji, senza caratteri di controllo tranne gli a capo (D63). */
export function cleanMessage(text: string): string {
  const kept = [...text.normalize('NFC')].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\n') return true;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false; // controllo
    if (code >= 0x200b && code <= 0x200f) return false; // spazi invisibili e direzione
    if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) return false;
    return true;
  });
  return kept
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Chat (D59, D63, D107, D180, D183): messaggi cifrati con la chiave del match, invio con la regola
 * `match`, `can_write` e il trigger; conversazione sospesa con un codice dedicato uguale per ogni
 * causa (D82); conferme di lettura solo se attive per entrambi; evento `message` all'altra persona
 * dopo il commit e push solo senza un canale connesso (D230).
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly coreRule: CoreRuleService,
    private readonly crypto: ChatCryptoService,
    private readonly limiter: RateLimiter,
    private readonly people: PeopleService,
    private readonly realtime: RealtimePublisher,
    private readonly notifications: NotificationsService,
  ) {}

  async send(
    me: string,
    matchId: string,
    rawText: string,
    clientMessageId: string,
  ): Promise<SentMessageDto> {
    const text = cleanMessage(rawText);
    if (text.length === 0 || [...text].length > MESSAGE_MAX_LENGTH) {
      throw ApiError.badRequest('validation', { fields: ['text'] });
    }
    const perMinute = await this.messagesPerMinute();
    if (!(await this.limiter.hit(`chat:${me}:${matchId}`, perMinute, 60))) {
      throw ApiError.tooManyRequests();
    }
    const outcome = await this.db.transaction(async (tx) => {
      await this.ensureWritable(me, matchId, tx);
      const existing = await this.find(tx, matchId, me, clientMessageId);
      if (existing)
        return {
          row: existing,
          bonus: false,
          other: await this.otherOf(tx, matchId, me),
          duplicate: true,
        };
      const before = await this.bonuses(tx, me);
      const sealed = await this.crypto.seal(matchId, text, tx);
      const inserted = await tx.execute<MessageRow>(sql`
        insert into messages (match_id, sender_id, ciphertext, nonce, client_message_id)
        values (${matchId}::uuid, ${me}::uuid, ${sealed.ciphertext}, ${sealed.nonce}, ${clientMessageId}::uuid)
        on conflict (match_id, sender_id, client_message_id) do nothing
        returning id, sender_id, client_message_id, ciphertext, nonce, created_at, read_at`);
      const row = inserted.rows[0] ?? (await this.find(tx, matchId, me, clientMessageId));
      if (!row) throw ApiError.notFound();
      const after = await this.bonuses(tx, me);
      return {
        row,
        bonus: after > before,
        other: await this.otherOf(tx, matchId, me),
        duplicate: !inserted.rows[0],
      };
    });
    if (!outcome.duplicate) {
      await this.realtime.publishAll([
        { userId: outcome.other, event: { type: 'message', matchId, messageId: outcome.row.id } },
        { userId: outcome.other, event: { type: 'tabs' } },
      ]);
      const sender = (await this.people.summaries([me])).get(me);
      await this.notifications.notify({
        userId: outcome.other,
        type: 'new_message',
        text: 'notification.message',
        data: { matchId },
        preview: { firstName: sender?.firstName ?? '', text },
      });
    }
    return {
      message: { ...this.toDto(outcome.row, me, text, false) },
      bonusAwarded: outcome.bonus,
      todaySlides: await this.people.todaySlides(me),
    };
  }

  async list(
    me: string,
    matchId: string,
    params: { after?: string; before?: string; limit?: number },
  ): Promise<MessagesDto> {
    const limit = params.limit ?? 50;
    const receipts = await this.receiptsOn(matchId);
    const cursorId = params.after ?? params.before ?? null;
    const direction = params.after ? 'after' : params.before ? 'before' : 'latest';
    const rows = await this.db.execute<MessageRow>(sql`
      with cursor as (select created_at, id from messages
                       where id = ${cursorId}::uuid and match_id = ${matchId}::uuid)
      select m.id, m.sender_id, m.client_message_id, m.ciphertext, m.nonce, m.created_at, m.read_at
        from messages m
       where m.match_id = ${matchId}::uuid
         and (${direction} <> 'after' or (m.created_at, m.id) > (select created_at, id from cursor))
         and (${direction} <> 'before' or (m.created_at, m.id) < (select created_at, id from cursor))
       order by case when ${direction} = 'after' then m.created_at end asc,
                case when ${direction} = 'after' then m.id end asc,
                m.created_at desc, m.id desc
       limit ${limit + 1}`);
    let page = rows.rows.slice(0, limit);
    const hasMore = direction !== 'after' && rows.rows.length > limit;
    if (direction !== 'after') page = page.reverse();
    const texts = await this.crypto.openAll(matchId, page);
    return {
      messages: page.map((row, index) => this.toDto(row, me, texts[index] ?? '', receipts)),
      hasMore,
    };
  }

  /** Conferma di lettura: segna letti i messaggi dell'altra persona fino a quello indicato. */
  async markRead(me: string, matchId: string, messageId: string): Promise<void> {
    const updated = await this.db.execute<{ id: string }>(sql`
      with target as (select created_at, id from messages
                       where id = ${messageId}::uuid and match_id = ${matchId}::uuid)
      update messages m set read_at = now()
        from target
       where m.match_id = ${matchId}::uuid and m.sender_id <> ${me}::uuid and m.read_at is null
         and (m.created_at, m.id) <= (target.created_at, target.id)
      returning m.id`);
    if (updated.rows.length === 0) return;
    const other = await this.otherOf(this.db, matchId, me);
    await this.realtime.publish(me, { type: 'tabs' });
    // L'evento `read` solo se le due persone hanno attivato le conferme (D63)
    if (await this.receiptsOn(matchId)) {
      await this.realtime.publish(other, { type: 'read', matchId, messageId });
    }
  }

  /**
   * `can_write` falsa: conversazione sospesa (un account non visibile, D82) con il codice dedicato;
   * ogni altro motivo è il `404` neutro.
   */
  async ensureWritable(me: string, matchId: string, tx: Executor): Promise<void> {
    if (await this.coreRule.canWrite(me, matchId, tx)) return;
    const frozen = await tx.execute(sql`
      select 1 from matches m
       where m.id = ${matchId}::uuid and m.status = 'active' and ${me}::uuid in (m.user_a_id, m.user_b_id)
         and not (account_visible(m.user_a_id) and account_visible(m.user_b_id))`);
    if (frozen.rows.length > 0) throw new ApiError(HttpStatus.CONFLICT, FeedChatError.matchFrozen);
    throw ApiError.notFound();
  }

  async otherOf(tx: Executor, matchId: string, me: string): Promise<string> {
    const result = await tx.execute<{ other: string }>(sql`
      select case when user_a_id = ${me}::uuid then user_b_id else user_a_id end as other
        from matches where id = ${matchId}::uuid`);
    return result.rows[0]!.other;
  }

  private toDto(row: MessageRow, me: string, text: string, receipts: boolean): MessageDto {
    const mine = row.sender_id === me;
    const dto: MessageDto = {
      id: row.id,
      clientMessageId: row.client_message_id,
      mine,
      text,
      createdAt: new Date(row.created_at).toISOString(),
    };
    if (mine && receipts) dto.readAt = row.read_at ? new Date(row.read_at).toISOString() : null;
    return dto;
  }

  private async find(
    tx: Executor,
    matchId: string,
    me: string,
    clientMessageId: string,
  ): Promise<MessageRow | null> {
    const result = await tx.execute<MessageRow>(sql`
      select id, sender_id, client_message_id, ciphertext, nonce, created_at, read_at from messages
       where match_id = ${matchId}::uuid and sender_id = ${me}::uuid
         and client_message_id = ${clientMessageId}::uuid`);
    return result.rows[0] ?? null;
  }

  private async bonuses(tx: Executor, me: string): Promise<number> {
    const result = await tx.execute<{ n: number }>(sql`
      select coalesce((select bonuses_received from daily_counters where user_id = ${me}::uuid
                        and day = (now() at time zone 'Europe/Rome')::date), 0)::int as n`);
    return Number(result.rows[0]?.n ?? 0);
  }

  private async receiptsOn(matchId: string): Promise<boolean> {
    const result = await this.db.execute<{ on: boolean }>(sql`
      select count(*) = 2 and bool_and(p.read_receipts) as on
        from matches m join profiles p on p.user_id in (m.user_a_id, m.user_b_id)
       where m.id = ${matchId}::uuid`);
    return result.rows[0]?.on === true;
  }

  private async messagesPerMinute(): Promise<number> {
    const result = await this.db.execute<{ n: number }>(sql`
      select coalesce((select (value #>> '{}')::int from config where key = 'chat.messages_per_minute'), 30) as n`);
    return Number(result.rows[0]?.n ?? 30);
  }
}
