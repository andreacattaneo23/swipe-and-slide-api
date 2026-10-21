import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor, pgErrorCode } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { ParametersService } from '../parameters/parameters.service';
import { rateLimitedUntil } from '../profiles/profiles.service';
import { TRIP_WINDOW_DAYS } from '../profiles/profile-view.service';

export interface Trip {
  id: string;
  city: { id: string; name: string; provinceCode: string };
  startDate: string;
  endDate: string;
  /** Primo giorno della finestra di visibilità nella città: 14 giorni prima (D57). */
  visibleFrom: string;
  /** Vero se oggi la trasferta è nella sua finestra di visibilità. */
  visibleNow: boolean;
}

export interface TripsOverview {
  trips: Trip[];
  max: number;
  showCalendar: boolean;
  /** Solo se il limite di frequenza non permette una nuova trasferta. */
  creatableAt: Date | null;
}

export interface TripInput {
  cityId: string;
  startDate: string;
  endDate: string;
}

type TripRow = {
  id: string;
  city_id: string;
  name: string;
  province_code: string;
  start_date: string;
  end_date: string;
  visible_from: string;
  visible_now: boolean;
};

/**
 * Modalità trasferta (D50, D57, D109): fino a 5 trasferte pianificate, inizio entro 3 mesi e non
 * nel passato, al massimo 8 settimane, nessuna sovrapposizione, città diversa dalla base e un
 * limite di frequenza. Effetto immediato: sono filtri del feed e non cambiano la visibilità.
 * Chi le ha pianificate le vede sempre con il nome reale del comune; gli altri solo la città
 * mostrata nella finestra (vedi `ProfileViewService`).
 */
@Injectable()
export class TripsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly parameters: ParametersService,
  ) {}

  async overview(userId: string): Promise<TripsOverview> {
    const [rows, calendar, max, creatableAt] = await Promise.all([
      this.db.execute<TripRow>(sql`
        select t.id, t.city_id, c.name, c.province_code, t.start_date::text as start_date,
               t.end_date::text as end_date,
               (t.start_date - ${TRIP_WINDOW_DAYS}::int)::text as visible_from,
               t.start_date - ${TRIP_WINDOW_DAYS}::int <= (now() at time zone 'Europe/Rome')::date as visible_now
          from trips t join cities c on c.id = t.city_id
         where t.user_id = ${userId}::uuid
           and t.end_date >= (now() at time zone 'Europe/Rome')::date
         order by t.start_date`),
      this.db.execute<{ show_calendar: boolean }>(
        sql`select show_calendar from profiles where user_id = ${userId}::uuid`,
      ),
      this.parameters.int('trips.max_planned', 5),
      this.creatableAt(userId, this.db),
    ]);
    return {
      trips: rows.rows.map(toTrip),
      max,
      showCalendar: calendar.rows[0]?.show_calendar ?? true,
      creatableAt,
    };
  }

  async create(userId: string, input: TripInput): Promise<Trip> {
    return this.save(userId, null, input);
  }

  async update(userId: string, tripId: string, input: TripInput): Promise<Trip> {
    return this.save(userId, tripId, input);
  }

  async remove(userId: string, tripId: string): Promise<void> {
    const result = await this.db.execute(
      sql`delete from trips where id = ${tripId}::uuid and user_id = ${userId}::uuid`,
    );
    if (!result.rowCount) throw ApiError.notFound();
  }

  /** Processo giornaliero `delete-past-trips`: il giorno dopo l'ultimo giorno, senza storico. */
  async deletePast(): Promise<number> {
    const result = await this.db.execute(
      sql`delete from trips where end_date < (now() at time zone 'Europe/Rome')::date`,
    );
    return result.rowCount ?? 0;
  }

  private async save(userId: string, tripId: string | null, input: TripInput): Promise<Trip> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
        const horizon = await this.parameters.int('trips.horizon_days', 92, tx);
        const checks = await tx.execute<{
          today_ok: boolean;
          horizon_ok: boolean;
          order_ok: boolean;
          length_ok: boolean;
          city_ok: boolean;
          base_city: boolean;
          overlap: boolean;
          planned: number;
          exists: boolean;
        }>(sql`
          select ${input.startDate}::date >= (now() at time zone 'Europe/Rome')::date as today_ok,
                 ${input.startDate}::date <= (now() at time zone 'Europe/Rome')::date + ${horizon}::int as horizon_ok,
                 ${input.endDate}::date >= ${input.startDate}::date as order_ok,
                 ${input.endDate}::date - ${input.startDate}::date <= 55 as length_ok,
                 exists (select 1 from cities where id = ${input.cityId} and is_active) as city_ok,
                 exists (select 1 from profiles where user_id = ${userId}::uuid
                                                  and home_city_id = ${input.cityId}) as base_city,
                 ${input.endDate}::date >= ${input.startDate}::date
                 and exists (select 1 from trips where user_id = ${userId}::uuid
                           and id is distinct from ${tripId}::uuid
                           and daterange(start_date, end_date, '[]')
                               && daterange(${input.startDate}::date, ${input.endDate}::date, '[]')) as overlap,
                 (select count(*)::int from trips where user_id = ${userId}::uuid
                     and id is distinct from ${tripId}::uuid
                     and end_date >= (now() at time zone 'Europe/Rome')::date) as planned,
                 ${tripId}::uuid is null
                   or exists (select 1 from trips where id = ${tripId}::uuid
                                                    and user_id = ${userId}::uuid) as exists`);
        const check = checks.rows[0]!;
        if (!check.exists) throw ApiError.notFound();
        if (!check.city_ok) throw new ApiError(422, 'trips.error.city');
        if (!check.order_ok) throw new ApiError(422, 'trips.error.period');
        if (!check.today_ok || !check.horizon_ok || !check.length_ok) {
          throw new ApiError(422, 'trips.error.limits');
        }
        if (check.base_city) throw new ApiError(422, 'trips.error.baseCity');
        if (check.overlap) throw new ApiError(422, 'trips.error.overlap');
        const max = await this.parameters.int('trips.max_planned', 5, tx);
        if (check.planned >= max) throw new ApiError(422, 'trips.limit.reached');
        // Limite di frequenza su creazioni e modifiche: crearle e cambiarle di continuo
        // permetterebbe di sondare il feed delle altre città (architettura, `rate_limit_events`)
        const creatableAt = await this.creatableAt(userId, tx);
        if (creatableAt) {
          throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'trips.error.frequency', {
            date: creatableAt,
          });
        }
        await tx.execute(
          sql`insert into rate_limit_events (user_id, type) values (${userId}::uuid, 'trip')`,
        );
        const saved = tripId
          ? await tx.execute<{ id: string }>(sql`
              update trips set city_id = ${input.cityId}, start_date = ${input.startDate}::date,
                     end_date = ${input.endDate}::date
               where id = ${tripId}::uuid and user_id = ${userId}::uuid returning id`)
          : await tx.execute<{ id: string }>(sql`
              insert into trips (user_id, city_id, start_date, end_date)
              values (${userId}::uuid, ${input.cityId}, ${input.startDate}::date, ${input.endDate}::date)
              returning id`);
        return this.one(tx, saved.rows[0]!.id);
      });
    } catch (error) {
      // Vincoli del database come ultima difesa: sovrapposizione e massimo in parallelo
      const code = pgErrorCode(error);
      if (code === '23P01') throw new ApiError(422, 'trips.error.overlap');
      if (code === 'SSP03') throw new ApiError(422, 'trips.limit.reached');
      if (code === '23514') throw new ApiError(422, 'trips.error.limits');
      throw error;
    }
  }

  private async one(tx: Executor, tripId: string): Promise<Trip> {
    const rows = await tx.execute<TripRow>(sql`
      select t.id, t.city_id, c.name, c.province_code, t.start_date::text as start_date,
             t.end_date::text as end_date, (t.start_date - ${TRIP_WINDOW_DAYS}::int)::text as visible_from,
             t.start_date - ${TRIP_WINDOW_DAYS}::int <= (now() at time zone 'Europe/Rome')::date as visible_now
        from trips t join cities c on c.id = t.city_id where t.id = ${tripId}::uuid`);
    return toTrip(rows.rows[0]!);
  }

  private async creatableAt(userId: string, tx: Executor): Promise<Date | null> {
    const max = await this.parameters.int('rate_limits.trip.max', 10, tx);
    const days = await this.parameters.int('rate_limits.trip.period_days', 30, tx);
    return rateLimitedUntil(tx, userId, 'trip', max, days);
  }
}

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    city: { id: row.city_id, name: row.name, provinceCode: row.province_code },
    startDate: row.start_date,
    endDate: row.end_date,
    visibleFrom: row.visible_from,
    visibleNow: row.visible_now,
  };
}
