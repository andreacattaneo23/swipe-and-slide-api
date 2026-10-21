import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database, type Executor, pgErrorCode } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { ChatCryptoService } from '../../domain/chat-crypto/chat-crypto.service';
import { NotificationsService } from '../../domain/notifications/notifications.service';
import { type PushTextKey } from '../../domain/notifications/push-texts';
import { WordFilterService } from '../../domain/safety/word-filter.service';
import { RealtimePublisher } from '../../domain/realtime/realtime-publisher';
import { ChatService } from '../chat/chat.service';
import { FeedChatError } from '../feed-chat/feed-chat.errors';
import { addDays, romeDate } from '../feed-chat/rome';
import {
  type InviteDto,
  type InviteFieldsDto,
  SLOT_RANGES,
  type SuggestionDto,
} from './invites.dto';

type InviteRow = {
  id: string;
  match_id: string;
  proposed_by: string;
  type: InviteDto['type'];
  day: string;
  time_slot: InviteDto['timeSlot'];
  time: string | null;
  venue: Buffer | null;
  venue_nonce: Buffer | null;
  city_id: string;
  city_name: string;
  status: string;
  replaces_id: string | null;
  created_at: Date;
};

const INVITE_COLUMNS = sql`
  i.id, i.match_id, i.proposed_by, i.type, i.day::text as day, i.time_slot,
  to_char(i.time, 'HH24:MI') as time, i.venue, i.venue_nonce, sc.id as city_id, sc.name as city_name,
  i.status, i.replaces_id, i.created_at`;

/** Ultimo giorno ammesso per un invito: 3 mesi da oggi (D197). */
function maxDay(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 3);
  return date.toISOString().slice(0, 10);
}

/**
 * Inviti a calendario e meeting dell'Agenda (D64, D145–D148, D163): stesso oggetto dalla chat e
 * dall'Agenda; regola `match`, `can_write` e trigger; una sola proposta in sospeso per match
 * (D147); luogo cifrato con la chiave del match (D183). Le righe dei due utenti e poi quella del
 * match si bloccano prima di ogni controllo, nello stesso ordine del trigger (architettura,
 * "Concorrenza").
 */
@Injectable()
export class InvitesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly chat: ChatService,
    private readonly crypto: ChatCryptoService,
    private readonly realtime: RealtimePublisher,
    private readonly notifications: NotificationsService,
    private readonly words: WordFilterService,
  ) {}

  async create(
    me: string,
    matchId: string,
    input: InviteFieldsDto,
    options: { requireExchange?: boolean } = {},
  ): Promise<InviteDto> {
    await this.validate(input);
    const { id, other } = await this.db.transaction(async (tx) => {
      await this.lockMatch(tx, matchId);
      await this.chat.ensureWritable(me, matchId, tx);
      if (options.requireExchange && !(await this.bothWrote(tx, matchId))) {
        throw ApiError.conflict('conflict'); // D148: serve uno scambio di messaggi
      }
      await this.ensureNoPending(tx, matchId);
      const created = await this.insert(tx, me, matchId, input, null);
      return { id: created, other: await this.chat.otherOf(tx, matchId, me) };
    });
    await this.announce(me, other, matchId, id, 'notification.invite');
    return this.get(me, matchId, id);
  }

  async respond(
    me: string,
    matchId: string,
    inviteId: string,
    answer: 'accept' | 'decline' | 'reschedule',
    proposal?: InviteFieldsDto,
  ): Promise<InviteDto> {
    if (answer === 'reschedule') {
      if (!proposal) throw ApiError.badRequest('validation', { fields: ['proposal'] });
      await this.validate(proposal);
    }
    const result = await this.db.transaction(async (tx) => {
      await this.lockMatch(tx, matchId);
      await this.chat.ensureWritable(me, matchId, tx);
      const current = await tx.execute<{ proposed_by: string }>(sql`
        select proposed_by from invites
         where id = ${inviteId}::uuid and match_id = ${matchId}::uuid and status = 'pending'
         for update`);
      const row = current.rows[0];
      if (!row) throw ApiError.notFound();
      if (row.proposed_by === me) throw ApiError.conflict('conflict'); // risponde l'altra persona
      if (answer === 'reschedule') {
        await tx.execute(sql`update invites set status = 'replaced', answered_at = now()
                              where id = ${inviteId}::uuid`);
        const created = await this.insert(tx, me, matchId, proposal!, inviteId);
        return { id: created, proposer: row.proposed_by };
      }
      await tx.execute(sql`
        update invites set status = ${answer === 'accept' ? 'accepted' : 'declined'}::invite_status,
                           answered_at = now()
         where id = ${inviteId}::uuid`);
      return { id: inviteId, proposer: row.proposed_by };
    });
    const text: PushTextKey | null =
      answer === 'accept'
        ? 'invite.accepted'
        : answer === 'reschedule'
          ? 'invite.toReschedule'
          : null;
    await this.announce(me, result.proposer, matchId, result.id, text);
    return this.get(me, matchId, result.id);
  }

  /** Annullamento di chi l'ha proposto, in sospeso o accettato per una data futura. */
  async cancel(me: string, matchId: string, inviteId: string): Promise<void> {
    const other = await this.db.transaction(async (tx) => {
      await this.lockMatch(tx, matchId);
      await this.chat.ensureWritable(me, matchId, tx);
      const updated = await tx.execute(sql`
        update invites set status = 'cancelled', answered_at = coalesce(answered_at, now())
         where id = ${inviteId}::uuid and match_id = ${matchId}::uuid and proposed_by = ${me}::uuid
           and (status = 'pending'
                or (status = 'accepted' and day >= (now() at time zone 'Europe/Rome')::date))
        returning id`);
      if (updated.rows.length === 0) throw ApiError.notFound();
      return this.chat.otherOf(tx, matchId, me);
    });
    await this.announce(me, other, matchId, inviteId, null);
  }

  async list(me: string, matchId: string): Promise<InviteDto[]> {
    const rows = await this.db.execute<InviteRow>(sql`
      select ${INVITE_COLUMNS}
        from invites i join cities c on c.id = i.city_id
        join cities sc on sc.id = coalesce(c.display_city_id, c.id)
       where i.match_id = ${matchId}::uuid
       order by i.created_at, i.id`);
    await this.db.execute(sql`
      update invites set seen_at = now()
       where match_id = ${matchId}::uuid and status = 'pending' and seen_at is null
         and proposed_by <> ${me}::uuid`);
    return this.toDtos(me, matchId, rows.rows);
  }

  async get(me: string, matchId: string, inviteId: string): Promise<InviteDto> {
    const rows = await this.db.execute<InviteRow>(sql`
      select ${INVITE_COLUMNS}
        from invites i join cities c on c.id = i.city_id
        join cities sc on sc.id = coalesce(c.display_city_id, c.id)
       where i.id = ${inviteId}::uuid and i.match_id = ${matchId}::uuid`);
    const [dto] = await this.toDtos(me, matchId, rows.rows);
    if (!dto) throw ApiError.notFound();
    return dto;
  }

  /**
   * Date in cui le città attive dei due coincidono (D64, D109): le proprie trasferte tutte, quelle
   * dell'altra persona solo nella finestra di 14 giorni e mai con il calendario nascosto; la città
   * base dell'altra persona solo come "stessa città". Almeno una delle due è in trasferta
   * [Proposta]; al più tre date, con la città mostrata.
   */
  async suggestions(me: string, matchId: string): Promise<SuggestionDto[]> {
    const result = await this.db.execute<{ day: string; city_id: string; city_name: string }>(sql`
      with other as (select case when user_a_id = ${me}::uuid then user_b_id else user_a_id end as id
                       from matches where id = ${matchId}::uuid),
      today as (select (now() at time zone 'Europe/Rome')::date as d),
      days as (select generate_series(today.d + 1, (today.d + interval '3 months')::date, interval '1 day')::date as d
                 from today),
      mine as (
        select days.d, coalesce(c.display_city_id, c.id) as shown, false as trip
          from days, profiles p join cities c on c.id = p.home_city_id where p.user_id = ${me}::uuid
        union all
        select days.d, coalesce(c.display_city_id, c.id), true
          from days join trips t on days.d between t.start_date and t.end_date
          join cities c on c.id = t.city_id where t.user_id = ${me}::uuid),
      theirs as (
        select days.d, coalesce(c.display_city_id, c.id) as shown, false as trip
          from days, other, profiles p join cities c on c.id = p.home_city_id where p.user_id = other.id
        union all
        select days.d, coalesce(c.display_city_id, c.id), true
          from days, today, other, profiles p, trips t join cities c on c.id = t.city_id
         where p.user_id = other.id and p.show_calendar and t.user_id = other.id
           and days.d between t.start_date and t.end_date and today.d >= t.start_date - 14)
      select distinct on (m.d) m.d::text as day, sc.id as city_id, sc.name as city_name
        from mine m join theirs x on x.d = m.d and x.shown = m.shown and (m.trip or x.trip)
        join cities sc on sc.id = m.shown
       order by m.d
       limit 3`);
    return result.rows.map((row) => ({
      day: row.day,
      city: { id: row.city_id, name: row.city_name },
    }));
  }

  async toDtos(me: string, matchId: string, rows: InviteRow[]): Promise<InviteDto[]> {
    const venues = await this.crypto.openAll(
      matchId,
      rows
        .filter((row) => row.venue && row.venue_nonce)
        .map((row) => ({ ciphertext: row.venue!, nonce: row.venue_nonce! })),
    );
    let index = 0;
    return rows.map((row) => {
      const venue = row.venue && row.venue_nonce ? (venues[index++] ?? null) : null;
      return {
        id: row.id,
        matchId: row.match_id,
        proposedByMe: row.proposed_by === me,
        type: row.type,
        day: row.day,
        timeSlot: row.time_slot,
        time: row.time,
        venue,
        city: { id: row.city_id, name: row.city_name },
        status: row.status,
        replacesId: row.replaces_id,
        slotState: slotState(row.status, row.replaces_id),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  /** Righe dei due utenti, poi il match: lo stesso ordine del trigger, nessuno stallo. */
  private async lockMatch(tx: Executor, matchId: string): Promise<void> {
    await tx.execute(sql`
      select 1 from users where id in (select user_a_id from matches where id = ${matchId}::uuid
                                       union select user_b_id from matches where id = ${matchId}::uuid)
       order by id for share`);
    await tx.execute(sql`select 1 from matches where id = ${matchId}::uuid for update`);
  }

  private async bothWrote(tx: Executor, matchId: string): Promise<boolean> {
    const result = await tx.execute<{ ok: boolean }>(sql`
      select (select count(distinct sender_id) from messages where match_id = m.id
               and sender_id in (m.user_a_id, m.user_b_id)) = 2 as ok
        from matches m where m.id = ${matchId}::uuid`);
    return result.rows[0]?.ok === true;
  }

  private async ensureNoPending(tx: Executor, matchId: string): Promise<void> {
    const pending = await tx.execute(
      sql`select 1 from invites where match_id = ${matchId}::uuid and status = 'pending'`,
    );
    if (pending.rows.length > 0)
      throw new ApiError(HttpStatus.CONFLICT, FeedChatError.meetingPending);
  }

  private async insert(
    tx: Executor,
    me: string,
    matchId: string,
    input: InviteFieldsDto,
    replacesId: string | null,
  ): Promise<string> {
    // Filtro delle parole anche sul nome del luogo, come per bio e risposte (D73, D146)
    if (!(await this.words.isAllowed(input.venue))) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'profile.text.rejected');
    }
    const venue = input.venue?.trim()
      ? await this.crypto.seal(matchId, input.venue.trim(), tx)
      : null;
    try {
      const created = await tx.execute<{ id: string }>(sql`
        insert into invites (match_id, proposed_by, type, day, time_slot, time, venue, venue_nonce,
                             city_id, replaces_id)
        values (${matchId}::uuid, ${me}::uuid, ${input.type}::invite_type, ${input.day}::date,
                ${input.timeSlot}::time_slot, ${input.time ?? null}::time,
                ${venue?.ciphertext ?? null}, ${venue?.nonce ?? null}, ${input.cityId},
                ${replacesId}::uuid)
        returning id`);
      return created.rows[0]!.id;
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        throw new ApiError(HttpStatus.CONFLICT, FeedChatError.meetingPending);
      }
      throw error;
    }
  }

  private async validate(input: InviteFieldsDto): Promise<void> {
    const today = romeDate();
    const fields: string[] = [];
    if (
      Number.isNaN(Date.parse(`${input.day}T00:00:00Z`)) ||
      input.day < addDays(today, 1) ||
      input.day > maxDay(today)
    ) {
      fields.push('day');
    }
    if (input.time) {
      const [from, to] = SLOT_RANGES[input.timeSlot];
      if (input.time < from || input.time > to) fields.push('time');
    }
    const city = await this.db.execute(
      sql`select 1 from cities where id = ${input.cityId} and is_active`,
    );
    if (city.rows.length === 0) fields.push('cityId');
    if (fields.length > 0) throw ApiError.badRequest('validation', { fields });
  }

  /** Eventi all'altra persona (invito) e alle due Agende; push solo con un testo (D65). */
  private async announce(
    me: string,
    other: string,
    matchId: string,
    inviteId: string,
    text: PushTextKey | null,
  ): Promise<void> {
    await this.realtime.publishAll([
      { userId: other, event: { type: 'invite', matchId, inviteId } },
      { userId: other, event: { type: 'agenda' } },
      { userId: other, event: { type: 'tabs' } },
      { userId: me, event: { type: 'agenda' } },
    ]);
    if (text) {
      await this.notifications.notify({
        userId: other,
        type: 'invite',
        text,
        data: { matchId, inviteId },
      });
    }
  }
}

export function slotState(status: string, replacesId: string | null): InviteDto['slotState'] {
  if (status === 'accepted') return 'confirmed';
  if (status === 'completed') return 'completed';
  if (status === 'pending') return replacesId ? 'to_reschedule' : 'awaiting_reply';
  return null;
}
