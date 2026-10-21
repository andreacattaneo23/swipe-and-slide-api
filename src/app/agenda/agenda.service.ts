import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { PeopleService } from '../feed-chat/people.service';
import { addDays, romeDate } from '../feed-chat/rome';
import { InvitesService } from '../invites/invites.service';
import {
  type AgendaDto,
  type AgendaPeopleItemDto,
  type MeetingDto,
  type UpcomingDto,
} from './agenda.dto';

const MAX_DAYS = 42;

type MeetingRow = {
  id: string;
  match_id: string;
  proposed_by: string;
  type: MeetingDto['type'];
  day: string;
  time_slot: MeetingDto['timeSlot'];
  time: string | null;
  venue: Buffer | null;
  venue_nonce: Buffer | null;
  city_id: string;
  city_name: string;
  status: string;
  replaces_id: string | null;
  created_at: Date;
  other: string;
  visible: boolean;
};

/**
 * Agenda (D145–D151): meeting dei soli match attivi dell'utente, con la regola `match` applicata a
 * ogni elemento nella query; conversazione sospesa come slot neutro; trasferte proprie come fasce
 * di sfondo; promemoria degli offsite a cui l'utente è iscritto. Nessun dato nuovo sugli altri.
 */
@Injectable()
export class AgendaService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invites: InvitesService,
    private readonly people: PeopleService,
  ) {}

  async range(me: string, from: string, to: string): Promise<AgendaDto> {
    if (to < from || addDays(from, MAX_DAYS) < to) {
      throw ApiError.badRequest('validation', { fields: ['to'] });
    }
    const meetings = await this.meetings(
      me,
      sql`i.day between ${from}::date and ${to}::date
      and i.status in ('pending', 'accepted', 'completed')`,
      500,
    );
    const trips = await this.db.execute<{ id: string; city: string; from: string; to: string }>(sql`
      select t.id, c.name as city, t.start_date::text as from, t.end_date::text as to
        from trips t join cities c on c.id = t.city_id
       where t.user_id = ${me}::uuid and t.start_date <= ${to}::date and t.end_date >= ${from}::date
       order by t.start_date`);
    const offsites = await this.db.execute<{
      id: string;
      title: string;
      starts_at: Date;
      ends_at: Date;
    }>(sql`
      select o.id, o.title, o.starts_at, o.ends_at
        from offsite_attendees a join offsites o on o.id = a.offsite_id
       where a.user_id = ${me}::uuid and o.status in ('published', 'completed')
         and (o.starts_at at time zone 'Europe/Rome')::date <= ${to}::date
         and (o.ends_at at time zone 'Europe/Rome')::date >= ${from}::date
       order by o.starts_at`);
    await this.markSeen(me, meetings);
    return {
      meetings,
      trips: trips.rows,
      offsites: offsites.rows.map((row) => ({
        id: row.id,
        title: row.title,
        startsAt: new Date(row.starts_at).toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
      })),
    };
  }

  async upcoming(me: string, cursor: string | undefined, limit = 20): Promise<UpcomingDto> {
    const [day, id] = cursor ? Buffer.from(cursor, 'base64url').toString('utf8').split('|') : [];
    const after = day && id && /^\d{4}-\d{2}-\d{2}$/.test(day) && /^[0-9a-f-]{36}$/i.test(id);
    const today = romeDate();
    const condition = after
      ? sql`i.status in ('pending', 'accepted') and i.day >= ${today}::date
            and (i.day, i.id) > (${day}::date, ${id}::uuid)`
      : sql`i.status in ('pending', 'accepted') and i.day >= ${today}::date`;
    const rows = await this.meetings(me, condition, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      meetings: page,
      next:
        rows.length > limit && last
          ? Buffer.from(`${last.day}|${last.id}`).toString('base64url')
          : null,
    };
  }

  /** Persone invitabili dall'Agenda: `can_write` e un messaggio di ognuna delle due (D148). */
  async invitable(me: string): Promise<AgendaPeopleItemDto[]> {
    const rows = await this.db.execute<{ id: string; other: string; pending: boolean }>(sql`
      select m.id, case when m.user_a_id = ${me}::uuid then m.user_b_id else m.user_a_id end as other,
             exists (select 1 from invites i where i.match_id = m.id and i.status = 'pending') as pending
        from matches m
       where m.status = 'active' and ${me}::uuid in (m.user_a_id, m.user_b_id)
         and can_write(${me}::uuid, m.id)
         and (select count(distinct x.sender_id) from messages x where x.match_id = m.id) = 2
       order by m.created_at desc`);
    const people = await this.people.summaries(rows.rows.map((row) => row.other));
    return rows.rows.map((row) => ({
      matchId: row.id,
      firstName: people.get(row.other)?.firstName ?? '',
      photo: people.get(row.other)?.photo ?? null,
      hasPendingInvite: row.pending,
    }));
  }

  private async meetings(
    me: string,
    condition: ReturnType<typeof sql>,
    limit: number,
  ): Promise<MeetingDto[]> {
    const rows = await this.db.execute<MeetingRow>(sql`
      select i.id, i.match_id, i.proposed_by, i.type, i.day::text as day, i.time_slot,
             to_char(i.time, 'HH24:MI') as time, i.venue, i.venue_nonce,
             sc.id as city_id, sc.name as city_name, i.status, i.replaces_id, i.created_at,
             case when m.user_a_id = ${me}::uuid then m.user_b_id else m.user_a_id end as other,
             account_visible(m.user_a_id) and account_visible(m.user_b_id) as visible
        from invites i join matches m on m.id = i.match_id
        join cities c on c.id = i.city_id join cities sc on sc.id = coalesce(c.display_city_id, c.id)
       where m.status = 'active' and ${me}::uuid in (m.user_a_id, m.user_b_id) and ${condition}
       order by i.day, i.id
       limit ${limit}`);
    const visibleOthers = rows.rows.filter((row) => row.visible).map((row) => row.other);
    const people = await this.people.summaries(visibleOthers);
    const result: MeetingDto[] = [];
    for (const row of rows.rows) {
      const [invite] = await this.invites.toDtos(me, row.match_id, [row]);
      const person = row.visible ? people.get(row.other) : undefined;
      const meeting: MeetingDto = { ...invite!, paused: !row.visible };
      if (person) meeting.person = { firstName: person.firstName, photo: person.photo };
      result.push(meeting);
    }
    return result;
  }

  private async markSeen(me: string, meetings: MeetingDto[]): Promise<void> {
    const ids = meetings.filter((m) => m.status === 'pending' && !m.proposedByMe).map((m) => m.id);
    if (ids.length === 0) return;
    await this.db.execute(sql`
      update invites set seen_at = now() where seen_at is null and id = any(${`{${ids.join(',')}}`}::uuid[])`);
  }
}
