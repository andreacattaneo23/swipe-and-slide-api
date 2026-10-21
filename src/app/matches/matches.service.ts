import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { RealtimePublisher } from '../../domain/realtime/realtime-publisher';
import { PeopleService } from '../feed-chat/people.service';
import { type MatchDto, type MatchListDto } from './matches.dto';

type MatchRow = {
  id: string;
  status: 'active' | 'closed';
  other: string | null;
  created_at: Date;
  chat_started_at: Date | null;
  visible: boolean;
  seen: boolean;
  unread: number;
  activity_at: Date;
  offsite_title: string | null;
  receipts: boolean;
  colleagues: boolean;
};

/**
 * Match (D30, D58–D62, D107): elenco con cognome e nome dell'azienda solo per i match attivi,
 * "Conversazione momentaneamente sospesa" con un account non visibile, "match non più
 * disponibile" per 30 giorni dopo la chiusura, senza motivo. Chiusura sempre possibile (D61).
 */
@Injectable()
export class MatchesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly people: PeopleService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(me: string, cursor: string | undefined, limit = 50): Promise<MatchListDto> {
    const [at, id] = cursor ? Buffer.from(cursor, 'base64url').toString('utf8').split('|') : [];
    const after = at && id && !Number.isNaN(Date.parse(at)) ? { at, id } : null;
    const rows = await this.rows(me, null, after, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      matches: await this.toDtos(page),
      next:
        rows.length > limit && last
          ? Buffer.from(`${new Date(last.activity_at).toISOString()}|${last.id}`).toString(
              'base64url',
            )
          : null,
    };
  }

  async get(me: string, matchId: string): Promise<MatchDto> {
    const [row] = await this.rows(me, matchId, null, 1);
    if (!row || row.status !== 'active') throw ApiError.notFound();
    const [dto] = await this.toDtos([row]);
    return dto!;
  }

  /** Chiusura da parte di una delle due persone (D61): l'altra vede "match non più disponibile". */
  async close(me: string, matchId: string): Promise<void> {
    const closed = await this.db.execute<{ user_a_id: string; user_b_id: string }>(sql`
      update matches set status = 'closed', close_reason = 'closed_by_user', closed_at = now()
       where id = ${matchId}::uuid and status = 'active'
         and ${me}::uuid in (user_a_id, user_b_id)
      returning user_a_id, user_b_id`);
    const row = closed.rows[0];
    if (!row) throw ApiError.notFound();
    // Stessa forma per ogni motivo di chiusura, nessuna notifica push (RC-197)
    await this.realtime.publishAll(
      [row.user_a_id, row.user_b_id].flatMap((userId) => [
        { userId, event: { type: 'match' as const, matchId, status: 'unavailable' as const } },
        { userId, event: { type: 'agenda' as const } },
      ]),
    );
  }

  async markSeen(me: string, matchId: string): Promise<void> {
    await this.db.execute(sql`
      update matches set user_a_seen_at = case when user_a_id = ${me}::uuid then coalesce(user_a_seen_at, now()) else user_a_seen_at end,
                         user_b_seen_at = case when user_b_id = ${me}::uuid then coalesce(user_b_seen_at, now()) else user_b_seen_at end
       where id = ${matchId}::uuid and ${me}::uuid in (user_a_id, user_b_id)`);
  }

  /** Match attivi e chiusi da meno di 30 giorni dell'utente, dal più recente. */
  private async rows(
    me: string,
    matchId: string | null,
    after: { at: string; id: string } | null,
    limit: number,
  ): Promise<MatchRow[]> {
    const result = await this.db.execute<MatchRow>(sql`
      with mine as (
        select m.*, case when m.user_a_id = ${me}::uuid then m.user_b_id else m.user_a_id end as other,
               case when m.user_a_id = ${me}::uuid then m.user_a_seen_at else m.user_b_seen_at end as my_seen,
               coalesce((select max(x.created_at) from messages x where x.match_id = m.id), m.created_at) as activity_at
          from matches m
         where ${me}::uuid in (m.user_a_id, m.user_b_id)
           and (m.status = 'active' or m.closed_at > now() - interval '30 days')
           and (${matchId}::uuid is null or m.id = ${matchId}::uuid))
      select x.id, x.status, x.other, x.created_at, x.chat_started_at, x.activity_at,
             x.my_seen is not null as seen,
             (x.status = 'active' and account_visible(x.user_a_id) and account_visible(x.user_b_id)) as visible,
             (select count(*)::int from messages y
               where y.match_id = x.id and y.sender_id <> ${me}::uuid and y.read_at is null) as unread,
             o.title as offsite_title,
             coalesce((select bool_and(p.read_receipts) from profiles p
                        where p.user_id in (x.user_a_id, x.user_b_id)), false)
               and (select count(*) from profiles p where p.user_id in (x.user_a_id, x.user_b_id)) = 2 as receipts,
             coalesce((select a.company_id = b.company_id from users a, users b
                        where a.id = x.user_a_id and b.id = x.user_b_id), false)
               and mutual_open_space(x.user_a_id, x.user_b_id) as colleagues
        from mine x left join offsites o on o.id = x.offsite_id
       where (${after?.at ?? null}::timestamptz is null
              or (x.activity_at, x.id) < (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid))
       order by x.activity_at desc, x.id desc
       limit ${limit}`);
    return result.rows;
  }

  private async toDtos(rows: MatchRow[]): Promise<MatchDto[]> {
    const visibleIds = rows.filter((r) => r.status === 'active' && r.other).map((r) => r.other!);
    const people = await this.people.summaries(visibleIds);
    return rows.map((row) => {
      const activityAt = new Date(row.activity_at).toISOString();
      if (row.status !== 'active' || !row.other) {
        return { id: row.id, state: 'unavailable', activityAt };
      }
      const person = people.get(row.other);
      const common = {
        id: row.id,
        chatStarted: row.chat_started_at !== null,
        deadlineAt: row.chat_started_at
          ? null
          : new Date(new Date(row.created_at).getTime() + 7 * 24 * 3600 * 1000).toISOString(),
        unreadCount: Number(row.unread),
        isNew: !row.seen,
        offsiteTitle: row.offsite_title,
        activityAt,
      };
      if (!row.visible) {
        // Conversazione sospesa: nessun dato oltre al nome, indistinguibile per ogni causa (D82)
        return { ...common, state: 'paused', person: { firstName: person?.firstName ?? '' } };
      }
      const dto: MatchDto = {
        ...common,
        state: 'active',
        readReceipts: row.receipts,
        person: {
          firstName: person?.firstName ?? '',
          lastName: person?.lastName ?? null,
          companyName: person?.companyName ?? '',
          photo: person?.photo ?? null,
        },
      };
      if (row.colleagues) dto.openSpaceColleagues = true;
      return dto;
    });
  }
}
