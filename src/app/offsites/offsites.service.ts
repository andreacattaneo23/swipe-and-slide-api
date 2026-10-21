import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { RealtimePublisher } from '../../domain/realtime/realtime-publisher';
import { FeedService } from '../feed/feed.service';
import { type FeedDto } from '../feed/feed.dto';
import { SwipesService } from '../swipes/swipes.service';
import { type OffsiteDetailDto, type OffsiteSummaryDto } from './offsites.dto';

type OffsiteRow = {
  id: string;
  title: string;
  description: string;
  starts_at: Date;
  ends_at: Date;
  city: string;
  venue_name: string;
  venue_address: string;
  cover_key: string | null;
  rounded: number;
  attending: boolean;
  show_on_profile: boolean;
  full: boolean;
  status: string;
  highlighted: boolean;
};

/**
 * Offsite lato app (D150–D154, D167): elenco e scheda con il solo numero di iscritti arrotondato
 * da `rounded_attendee_count` (mai l'elenco né il numero esatto), iscrizione con la capienza nel
 * database, riga "sarò all'offsite", swipe tra gli iscritti senza la distanza.
 */
@Injectable()
export class AppOffsitesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly feed: FeedService,
    private readonly swipes: SwipesService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(me: string): Promise<OffsiteSummaryDto[]> {
    const rows = await this.rows(me, null);
    return rows.map((row) => this.summary(row));
  }

  async get(me: string, id: string): Promise<OffsiteDetailDto> {
    const [row] = await this.rows(me, id);
    if (!row) throw ApiError.notFound();
    const open = await this.swipes.offsiteWindowOpen(me, id);
    return {
      ...this.summary(row),
      description: row.description,
      venueAddress: row.venue_address,
      showOnProfile: row.show_on_profile,
      swipeOpen: open && row.status !== 'cancelled',
      swipeClosesAt: row.attending
        ? new Date(new Date(row.ends_at).getTime() + 24 * 3600 * 1000).toISOString()
        : null,
    };
  }

  /** "Partecipo": solo account attivi e approvati con il profilo completo; capienza nel database. */
  async attend(me: string, id: string): Promise<OffsiteDetailDto> {
    if ((await this.feed.requesterState(me)) === 'unavailable') throw ApiError.notFound();
    // Offsite di un altro tipo o non pubblicato: come inesistente (D197)
    const [visible] = await this.rows(me, id);
    if (!visible || visible.status !== 'published') throw ApiError.notFound();
    const complete = await this.db.execute(sql`
      select 1 from profiles where user_id = ${me}::uuid and is_complete`);
    if (complete.rows.length === 0) throw ApiError.conflict('conflict');
    const before = await this.rounded(id);
    await this.db.execute(sql`
      insert into offsite_attendees (offsite_id, user_id) values (${id}::uuid, ${me}::uuid)
      on conflict (offsite_id, user_id) do nothing`);
    await this.afterCountChange(id, before);
    return this.get(me, id);
  }

  async patch(me: string, id: string, showOnProfile: boolean): Promise<OffsiteDetailDto> {
    const updated = await this.db.execute(sql`
      update offsite_attendees set show_on_profile = ${showOnProfile}
       where offsite_id = ${id}::uuid and user_id = ${me}::uuid returning 1`);
    if (updated.rows.length === 0) throw ApiError.notFound();
    return this.get(me, id);
  }

  /** "Non partecipo più": esce dallo swipe dell'offsite, i match già nati restano. */
  async leave(me: string, id: string): Promise<void> {
    const before = await this.rounded(id);
    await this.db.execute(sql`
      delete from offsite_attendees where offsite_id = ${id}::uuid and user_id = ${me}::uuid`);
    await this.afterCountChange(id, before);
  }

  /** Swipe dell'offsite (D152): chi non è iscritto o è fuori finestra ha la risposta di un offsite inesistente. */
  async feedFor(me: string, id: string): Promise<FeedDto> {
    if (!(await this.swipes.offsiteWindowOpen(me, id))) throw ApiError.notFound();
    const cancelled = await this.db.execute(
      sql`select 1 from offsites where id = ${id}::uuid and status = 'cancelled'`,
    );
    if (cancelled.rows.length > 0) throw ApiError.notFound();
    return this.feed.feed(me, { offsiteId: id });
  }

  private async rounded(id: string): Promise<number> {
    const result = await this.db.execute<{ n: number }>(
      sql`select rounded_attendee_count(${id}::uuid) as n`,
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  /** Evento agli iscritti solo quando cambia la fascia arrotondata (D167, architettura). */
  private async afterCountChange(id: string, before: number): Promise<void> {
    const after = await this.rounded(id);
    if (after === before) return;
    const attendees = await this.db.execute<{ user_id: string }>(
      sql`select user_id from offsite_attendees where offsite_id = ${id}::uuid`,
    );
    await this.realtime.publishAll(
      attendees.rows.map((row) => ({
        userId: row.user_id,
        event: { type: 'offsite' as const, offsiteId: id, attendeesRounded: after },
      })),
    );
  }

  private summary(row: OffsiteRow): OffsiteSummaryDto {
    return {
      id: row.id,
      title: row.title,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      city: row.city,
      venueName: row.venue_name,
      coverUrl: row.cover_key ? `/media/offsites/${encodeURIComponent(row.cover_key)}` : null,
      attendeesRounded: Number(row.rounded),
      attending: row.attending,
      full: row.full,
      status: row.status,
      highlighted: row.highlighted,
    };
  }

  /**
   * Offsite pubblicati futuri o in corso dello stesso tipo dell'utente (D197); un annullato solo per
   * chi era iscritto e fino alla sua data (D233). Il numero esatto serve solo per "Al completo".
   */
  private async rows(me: string, id: string | null): Promise<OffsiteRow[]> {
    const result = await this.db.execute<OffsiteRow>(sql`
      with me as (select u.id, u.is_demo from users u where u.id = ${me}::uuid),
      places as (
        select coalesce(c.display_city_id, c.id) as shown
          from active_cities(${me}::uuid, (now() at time zone 'Europe/Rome')::date) a
          join cities c on c.id = a.city_id)
      select o.id, o.title, o.description, o.starts_at, o.ends_at, c.name as city,
             o.venue_name, o.venue_address, o.cover_key, rounded_attendee_count(o.id) as rounded,
             a.user_id is not null as attending, coalesce(a.show_on_profile, false) as show_on_profile,
             (o.capacity is not null
              and (select count(*) from offsite_attendees x where x.offsite_id = o.id) >= o.capacity) as full,
             o.status,
             coalesce(c.display_city_id, c.id) in (select shown from places) as highlighted
        from me join offsites o on o.is_demo = me.is_demo
        join cities c on c.id = o.city_id
        left join offsite_attendees a on a.offsite_id = o.id and a.user_id = me.id
       where (${id}::uuid is null or o.id = ${id}::uuid)
         and ((o.status in ('published', 'completed') and o.ends_at + interval '24 hours' > now())
              or (o.status = 'cancelled' and a.user_id is not null and o.starts_at > now()))
       order by o.starts_at, o.id`);
    return result.rows;
  }
}
