import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Pool } from 'pg';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppApiModule } from '../../src/app/app-api.module';
import { AccessTokenService } from '../../src/app/auth/access-token.service';
import { type RealtimeEnvelope } from '../../src/core/realtime/events';
import { RateLimiter } from '../../src/infra/cache/rate-limiter';
import { EMAIL_SENDER } from '../../src/infra/email/email-sender';
import { CaptureEmailSender } from './capture-email-sender';
import { setupApp } from '../../src/infra/http/setup-app';
import { type PushMessage, PushSender } from '../../src/infra/push/push-sender';
import { RedisRealtimeBus } from '../../src/infra/realtime-bus/realtime-bus';
import { testConfig } from './test-config';

/** Comuni di prova con coordinate reali dei centroidi (circa). */
export const CITIES = {
  milano: { id: '015146', name: 'Milano', lat: 45.4642, lon: 9.19, population: 1371498 },
  monza: { id: '108033', name: 'Monza', lat: 45.5845, lon: 9.2744, population: 123000 },
  bergamo: { id: '016024', name: 'Bergamo', lat: 45.6983, lon: 9.6773, population: 120000 },
  roma: { id: '058091', name: 'Roma', lat: 41.9028, lon: 12.4964, population: 2770000 },
  // Comune piccolo mostrato come Milano (D109)
  pero: {
    id: '015170',
    name: 'Pero',
    lat: 45.5099,
    lon: 9.0882,
    population: 11000,
    shown: '015146',
  },
  settala: {
    id: '015206',
    name: 'Settala',
    lat: 45.4545,
    lon: 9.3889,
    population: 7500,
    shown: '015146',
  },
} as const;

export type CityKey = keyof typeof CITIES;

export interface ProfileOptions {
  city?: CityKey;
  gender?: 'woman' | 'man' | 'non_binary' | 'undisclosed';
  interestedIn?: 'men' | 'women' | 'everyone';
  birthDate?: string;
  ageMin?: number;
  ageMax?: number;
  maxDistance?: 'city' | 'km25' | 'km50' | 'km100' | 'km200' | 'italy';
  practiceArea?: string | null;
  readReceipts?: boolean;
  showCalendar?: boolean;
  firstName?: string;
  lastName?: string | null;
}

/** Dati e sessioni per le prove di feed, swipe, match, chat, Agenda e offsite. */
export class FeedChatFixture {
  constructor(private readonly pool: Pool) {}

  async cities(): Promise<void> {
    for (const city of Object.values(CITIES)) {
      await this.pool.query(
        `insert into cities (id, name, province_code, region, lat, lon, population, search_name, display_city_id)
         values ($1, $2, 'XX', 'Regione', $3, $4, $5, lower($2), $6) on conflict (id) do nothing`,
        [
          city.id,
          city.name,
          city.lat,
          city.lon,
          city.population,
          'shown' in city ? city.shown : null,
        ],
      );
    }
  }

  /** Profilo completo: città base, genere, preferenze e due foto approvate (D51, D109). */
  async profile(userId: string, options: ProfileOptions = {}): Promise<void> {
    await this.pool.query(
      `update profiles set home_city_id = $2, gender = $3, interested_in = $4, age_min = $5,
              age_max = $6, max_distance = $7, practice_area = $8, read_receipts = $9,
              show_calendar = $10, first_name = $11, last_name = $12
        where user_id = $1`,
      [
        userId,
        CITIES[options.city ?? 'milano'].id,
        options.gender ?? 'woman',
        options.interestedIn ?? 'everyone',
        options.ageMin ?? 18,
        options.ageMax ?? 99,
        options.maxDistance ?? 'km50',
        options.practiceArea ?? null,
        options.readReceipts ?? false,
        options.showCalendar ?? true,
        options.firstName ?? 'Persona',
        options.lastName ?? null,
      ],
    );
    if (options.birthDate) {
      await this.pool.query('update profiles set birth_date = $2 where user_id = $1', [
        userId,
        options.birthDate,
      ]);
    }
    const { rows } = await this.pool.query<{ n: string }>(
      "select count(*) as n from photos where user_id = $1 and status = 'approved'",
      [userId],
    );
    for (let position = Number(rows[0]!.n) + 1; position <= 2; position++) {
      await this.pool.query(
        `insert into photos (user_id, storage_key, position, status) values ($1, $2, $3, 'approved')`,
        [userId, `test/${userId}/${position}-${randomUUID()}`, position],
      );
    }
  }

  async trip(userId: string, city: CityKey, fromDays: number, toDays: number): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into trips (user_id, city_id, start_date, end_date)
       values ($1, $2, (now() at time zone 'Europe/Rome')::date + $3::int,
               (now() at time zone 'Europe/Rome')::date + $4::int) returning id`,
      [userId, CITIES[city].id, fromDays, toDays],
    );
    return rows[0]!.id;
  }

  async offsite(
    options: { capacity?: number; isDemo?: boolean; status?: string; endsInHours?: number } = {},
  ): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into offsites (title, description, venue_name, venue_address, city_id, starts_at, ends_at,
                             capacity, status, is_demo, published_at)
       values ('Aperitivo di fine quarter', 'Descrizione', 'Terrazza', 'Via Roma 1', $1,
               now() + make_interval(hours => $2::int - 3), now() + make_interval(hours => $2::int),
               $3, $4, $5, now()) returning id`,
      [
        CITIES.milano.id,
        options.endsInHours ?? 48,
        options.capacity ?? null,
        options.status ?? 'published',
        options.isDemo ?? false,
      ],
    );
    return rows[0]!.id;
  }
}

/** Doppio del test al posto di Expo Push: registra le notifiche che partirebbero. */
export class RecordingPushSender extends PushSender {
  readonly sent: PushMessage[] = [];

  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    this.sent.push(...messages);
    return Promise.resolve({ invalidTokens: [] });
  }
}

export interface FeedChatApp {
  app: INestApplication<App>;
  push: RecordingPushSender;
  token(userId: string, scope?: 'full' | 'approval'): Promise<string>;
  api(): ReturnType<typeof request>;
  /** Eventi pubblicati su Redis (canale vero), da filtrare per i propri utenti. */
  events: RealtimeEnvelope[];
  close(): Promise<void>;
}

/** App `app-api` di prova su PostgreSQL e Redis veri; solo le push passano da un doppio. */
export async function createFeedChatApp(pool: Pool): Promise<FeedChatApp> {
  const push = new RecordingPushSender();
  const moduleRef = await Test.createTestingModule({
    imports: [AppApiModule.forRoot(testConfig('app'))],
  })
    .overrideProvider(EMAIL_SENDER)
    .useValue(new CaptureEmailSender())
    .overrideProvider(RateLimiter)
    .useValue({ hit: () => Promise.resolve(true) })
    .overrideProvider(PushSender)
    .useValue(push)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    bodyParser: false,
    logger: process.env.TEST_LOGS ? ['error', 'warn'] : false,
  });
  setupApp(app);
  await app.init();
  const events: RealtimeEnvelope[] = [];
  const bus = new RedisRealtimeBus(testConfig('app').redisUrl!);
  const unsubscribe = await bus.subscribe((envelope) => events.push(envelope));
  const tokens = app.get(AccessTokenService);
  return {
    app,
    push,
    events,
    api: () => request(app.getHttpServer()),
    async token(userId, scope = 'full') {
      const { rows } = await pool.query<{ id: string }>(
        `insert into sessions (user_id, refresh_hash, scope, sign_in_method, expires_at)
         values ($1, $2, $3, 'personal_email', now() + interval '30 days') returning id`,
        [userId, `test-${randomUUID()}`, scope],
      );
      return tokens.sign({ userId, sessionId: rows[0]!.id, scope });
    },
    async close() {
      unsubscribe();
      await bus.close();
      await app.close();
    },
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Attende che gli eventi pubblicati su Redis arrivino. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 150));
