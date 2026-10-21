import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database, type Executor } from '../../infra/database/database';
import { PhotosService } from '../../domain/photos/photos.service';
import { ProfileViewService } from '../../domain/profiles/profile-view.service';
import { type MatchProfileDto } from '../profile/profile.dto';
import { uuidArray } from './rome';
import {
  type CardDto,
  type DistanceBand,
  type PhotoDto,
  type TodaySlidesDto,
  type TripPeriodDto,
} from './people.dto';

/** Esito di `feed_candidates` per un candidato. */
export type Candidate = {
  user_id: string;
  band: string | null;
  trip_id: string | null;
  escalation: boolean;
  open_space_colleagues: boolean;
};

type PersonRow = {
  id: string;
  first_name: string | null;
  age: number;
  practice_area: string | null;
  looking_for: string | null;
};

/**
 * Dati mostrati delle altre persone (architettura, "Cosa vedono gli altri"): si leggono solo dopo
 * la regola (`can_interact` per feed e profilo dal feed, regola `match` per il match), da chi
 * chiama. Foto solo approvate (D143), città solo come città mostrata (D109), trasferte solo nella
 * finestra di 14 giorni e mai con il calendario nascosto, nessun campo dell'azienda fuori dal match.
 */
@Injectable()
export class PeopleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly photosService: PhotosService,
    private readonly views: ProfileViewService,
  ) {}

  async cards(candidates: Candidate[], tx: Executor = this.db): Promise<CardDto[]> {
    if (candidates.length === 0) return [];
    const ids = candidates.map((candidate) => candidate.user_id);
    const people = await this.people(ids, tx);
    const photos = await this.photos(ids, tx);
    const tripIds = candidates.map((c) => c.trip_id).filter((id): id is string => !!id);
    const trips = new Map<string, TripPeriodDto>();
    if (tripIds.length > 0) {
      const rows = await tx.execute<{ id: string; city: string; from: string; to: string }>(sql`
        select t.id, sc.name as city, t.start_date::text as from, t.end_date::text as to
          from trips t join cities c on c.id = t.city_id
          join cities sc on sc.id = coalesce(c.display_city_id, c.id)
         where t.id = any(${uuidArray(tripIds)}::uuid[])`);
      for (const row of rows.rows)
        trips.set(row.id, { city: row.city, from: row.from, to: row.to });
    }
    const cards: CardDto[] = [];
    for (const candidate of candidates) {
      const person = people.get(candidate.user_id);
      if (!person) continue;
      const card = this.card(person, photos.get(person.id) ?? []);
      const trip = candidate.trip_id ? trips.get(candidate.trip_id) : undefined;
      if (trip) card.trip = trip;
      else if (candidate.band) card.distance = candidate.band as DistanceBand;
      if (candidate.escalation) card.escalation = true;
      if (candidate.open_space_colleagues) card.openSpaceColleagues = true;
      cards.push(card);
    }
    return cards;
  }

  /**
   * Dati del feed da aggiungere al profilo aperto dal feed (`ProfileViewService.fromFeed`): fascia
   * di distanza ed escalation ricevuta. La regola `interact` l'ha già controllata la guard.
   */
  async feedExtras(
    viewerId: string,
    userId: string,
    tx: Executor = this.db,
  ): Promise<{ distance?: DistanceBand; escalation?: true }> {
    const candidate = await tx.execute<Candidate>(sql`
      select * from feed_candidates(${viewerId}::uuid, false, null, ${uuidArray([userId])}::uuid[], 1)`);
    const flags = await tx.execute<{ escalation: boolean }>(sql`
      select exists (select 1 from swipes s where s.from_user_id = ${userId}::uuid
                      and s.to_user_id = ${viewerId}::uuid and s.type = 'escalation'
                      and s.expires_at > now()) as escalation`);
    const extras: { distance?: DistanceBand; escalation?: true } = {};
    const band = candidate.rows[0]?.band;
    if (band) extras.distance = band as DistanceBand;
    if (flags.rows[0]?.escalation) extras.escalation = true;
    return extras;
  }

  /**
   * Deck dal match: il profilo di `ProfileViewService.deck()` con cognome e nome dell'azienda
   * attuale (D30, D107). La regola `match` l'ha già controllata la guard.
   */
  async matchDeck(
    viewerId: string,
    userId: string,
    tx: Executor = this.db,
  ): Promise<MatchProfileDto | null> {
    const extra = await tx.execute<{ last_name: string | null; company_name: string }>(sql`
      select p.last_name, z.name as company_name
        from users u join profiles p on p.user_id = u.id join companies z on z.id = u.company_id
       where u.id = ${userId}::uuid and p.first_name is not null`);
    const row = extra.rows[0];
    if (!row) return null;
    const deck = await this.views.deck(viewerId, userId, tx);
    return { ...deck, lastName: row.last_name, companyName: row.company_name };
  }

  /** Nome, foto principale e dati del match per elenchi, Deal Closed! e Agenda. */
  async summaries(
    ids: string[],
    tx: Executor = this.db,
  ): Promise<
    Map<
      string,
      {
        firstName: string;
        lastName: string | null;
        companyName: string | null;
        photo: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        firstName: string;
        lastName: string | null;
        companyName: string | null;
        photo: string | null;
      }
    >();
    if (ids.length === 0) return result;
    const rows = await tx.execute<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
    }>(sql`
      select u.id, p.first_name, p.last_name, z.name as company_name
        from users u join profiles p on p.user_id = u.id left join companies z on z.id = u.company_id
       where u.id = any(${uuidArray(ids)}::uuid[])`);
    const photos = await this.photos(ids, tx);
    for (const row of rows.rows) {
      result.set(row.id, {
        firstName: row.first_name ?? '',
        lastName: row.last_name,
        companyName: row.company_name,
        photo: photos.get(row.id)?.[0]?.url ?? null,
      });
    }
    return result;
  }

  /** Budget del giorno dell'utente stesso (D123, D136, D177): mai like ricevuti. */
  async todaySlides(userId: string, tx: Executor = this.db): Promise<TodaySlidesDto> {
    const result = await tx.execute<{
      likes: number;
      escalations: number;
      total: number;
      daily_escalations: number;
    }>(sql`
      with cfg as (
        select coalesce((select (value #>> '{}')::int from config where key = 'swipes.daily_likes'), 25) as likes,
               coalesce((select (value #>> '{}')::int from config where key = 'swipes.daily_escalations'), 1) as escalations)
      select coalesce(d.likes_used, 0) as likes, coalesce(d.escalations_used, 0) as escalations,
             cfg.likes + 3 * coalesce(d.bonuses_received, 0) as total, cfg.escalations as daily_escalations
        from cfg left join daily_counters d
          on d.user_id = ${userId}::uuid and d.day = (now() at time zone 'Europe/Rome')::date`);
    const row = result.rows[0]!;
    return {
      remaining: Math.max(0, Number(row.total) - Number(row.likes)),
      total: Number(row.total),
      escalationsRemaining: Math.max(0, Number(row.daily_escalations) - Number(row.escalations)),
    };
  }

  private card(person: PersonRow, photos: PhotoDto[]): CardDto {
    return {
      id: person.id,
      firstName: person.first_name ?? '',
      age: Number(person.age),
      practiceArea: person.practice_area,
      lookingFor: person.looking_for,
      photos,
    };
  }

  private async people(ids: string[], tx: Executor): Promise<Map<string, PersonRow>> {
    const rows = await tx.execute<PersonRow>(sql`
      select u.id, p.first_name, age_years(p.birth_date) as age, p.practice_area, p.looking_for
        from users u join profiles p on p.user_id = u.id
       where u.id = any(${uuidArray(ids)}::uuid[])`);
    return new Map(rows.rows.map((row) => [row.id, row]));
  }

  private photos(ids: string[], tx: Executor): Promise<Map<string, PhotoDto[]>> {
    return this.photosService.approvedForMany(ids, tx);
  }
}
