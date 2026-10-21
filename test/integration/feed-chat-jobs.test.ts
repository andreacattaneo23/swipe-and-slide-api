// Processi pianificati di feed, match, inviti e offsite (architettura, "Processi pianificati"),
// con il ruolo `jobs_role`, PostgreSQL e Redis veri; il tempo si simula spostando le date.
import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PushSender } from '../../src/infra/push/push-sender';
import {
  cleanCounters,
  cleanInvites,
  deleteClosedMatches,
  expireSwipes,
  matchDeadlines,
  offsiteNotices,
} from '../../src/jobs/feed-chat.jobs';
import { JobsModule } from '../../src/jobs/jobs.module';
import { Factory } from '../support/factory';
import { FeedChatFixture, RecordingPushSender } from '../support/feed-chat';
import { testConfig } from '../support/test-config';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
const f = new Factory(pool);
const fx = new FeedChatFixture(pool);
const push = new RecordingPushSender();
let context: INestApplicationContext;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [JobsModule.forRoot({ ...testConfig('app'), databaseRole: 'jobs_role' })],
  })
    .overrideProvider(PushSender)
    .useValue(push)
    .compile();
  context = await moduleRef.init();
});
beforeEach(async () => {
  await truncateAll(pool);
  await fx.cities();
  push.sent.length = 0;
});
afterAll(async () => {
  await context.close();
  await pool.end();
});

async function person() {
  const id = await f.user(await f.company());
  await fx.profile(id);
  await pool.query(
    "insert into devices (user_id, installation_id, push_token, platform) values ($1, $2, $3, 'ios')",
    [id, `install-${id.slice(0, 8)}`, `ExponentPushToken[${id}]`],
  );
  return id;
}

describe('Processi di feed, match e inviti', () => {
  it('match-deadlines: promemoria a 3 giorni e mezzo una volta, scadenza a 7 giorni senza messaggi', async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    const reminded = await f.match(a, b);
    const expired = await f.match(a, c);
    const started = await f.match(b, c, { withMessageFrom: b });
    await pool.query("update matches set created_at = now() - interval '4 days' where id = $1", [
      reminded,
    ]);
    await pool.query(
      "update matches set created_at = now() - interval '8 days' where id in ($1, $2)",
      [expired, started],
    );
    const counts = await matchDeadlines.run(context);
    expect(counts).toMatchObject({ expired: 1 });
    const statuses = await pool.query<{
      id: string;
      status: string;
      close_reason: string | null;
      expiry_reminder_at: Date | null;
    }>('select id, status, close_reason, expiry_reminder_at from matches');
    const byId = Object.fromEntries(statuses.rows.map((row) => [row.id, row]));
    expect(byId[expired]).toMatchObject({ status: 'closed', close_reason: 'expired' });
    expect(byId[started]).toMatchObject({ status: 'active' });
    // Il promemoria rispetta la notte (D197): di giorno parte ai due, di notte si rimanda
    const hour = Number(
      new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    if (hour >= 8 && hour < 22) {
      expect(byId[reminded]!.expiry_reminder_at).not.toBeNull();
      expect(push.sent.map((p) => p.body)).toEqual([
        'Deadline in avvicinamento',
        'Deadline in avvicinamento',
      ]);
      await matchDeadlines.run(context);
      expect(push.sent).toHaveLength(2);
    } else {
      expect(byId[reminded]!.expiry_reminder_at).toBeNull();
    }
  });

  it('expire-swipes, delete-closed-matches, clean-invites e clean-counters', async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    await f.like(a, b);
    await pool.query("update swipes set expires_at = now() - interval '1 minute'");
    const old = await f.match(a, c, { withMessageFrom: a });
    await pool.query(
      "update matches set status = 'closed', close_reason = 'closed_by_user', closed_at = now() - interval '31 days' where id = $1",
      [old],
    );
    const active = await f.match(b, c, { withMessageFrom: b });
    await f.invite(active, b, '015146');
    await pool.query('update invites set day = current_date - 31');
    await pool.query(
      'insert into daily_counters (user_id, day, likes_used) values ($1, current_date - 5, 3)',
      [a],
    );
    expect(await expireSwipes.run(context)).toEqual({ deleted: 1 });
    expect(await deleteClosedMatches.run(context)).toEqual({ deleted: 1 });
    expect(await cleanInvites.run(context)).toEqual({ deleted: 1 });
    expect(await cleanCounters.run(context)).toEqual({ deleted: 1 });
    const messages = await pool.query('select count(*)::int as n from messages');
    expect(messages.rows[0].n).toBe(1); // solo quelli del match attivo
  });

  it('offsite-notices: avviso accodato dal backoffice consegnato agli iscritti, una volta', async () => {
    const offsite = await fx.offsite();
    const a = await person();
    await pool.query('insert into offsite_attendees (offsite_id, user_id) values ($1, $2)', [
      offsite,
      a,
    ]);
    await pool.query("insert into offsite_notices (offsite_id, kind) values ($1, 'cancelled')", [
      offsite,
    ]);
    expect(await offsiteNotices.run(context)).toMatchObject({ notices: 1 });
    expect(push.sent.map((p) => p.body)).toEqual(['Offsite annullato']);
    expect(await offsiteNotices.run(context)).toMatchObject({ notices: 0 });
  });
});
