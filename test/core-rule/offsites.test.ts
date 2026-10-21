// Suite RC: offsite lato app (D150–D154, D167): elenco e scheda con il solo numero arrotondato,
// iscrizione con la capienza nel database, swipe tra gli iscritti senza la distanza.
import { Pool } from 'pg';
import { Factory } from '../support/factory';
import { bearer, createFeedChatApp, type FeedChatApp, FeedChatFixture } from '../support/feed-chat';
import { sqlState } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
const f = new Factory(pool);
const fx = new FeedChatFixture(pool);
let t: FeedChatApp;

beforeAll(async () => {
  t = await createFeedChatApp(pool);
});
beforeEach(async () => {
  await truncateAll(pool);
  await fx.cities();
});
afterAll(async () => {
  await t.close();
  await pool.end();
});

async function person(
  options: { company?: string; openSpace?: boolean; city?: 'milano' | 'roma' } = {},
) {
  const id = await f.user(options.company ?? (await f.company()), {
    openSpace: options.openSpace ?? false,
  });
  await fx.profile(id, { city: options.city ?? 'roma', maxDistance: 'city' });
  return id;
}

const attend = async (userId: string, offsite: string, expected = 200) =>
  t
    .api()
    .put(`/offsites/${offsite}/attendance`)
    .set(bearer(await t.token(userId)))
    .expect(expected);

const offsiteFeed = async (userId: string, offsite: string, expected = 200) =>
  t
    .api()
    .get(`/offsites/${offsite}/feed`)
    .set(bearer(await t.token(userId)))
    .expect(expected);

describe('Offsite (D150–D154)', () => {
  it("RC-173 swipe dell'offsite: regole del feed tranne la distanza", async () => {
    const x = await f.company();
    const z = await f.company();
    const offsite = await fx.offsite();
    const a = await person({ company: x, openSpace: true });
    const colleagueOs = await person({ company: x, openSpace: true });
    const colleague = await person({ company: x });
    const excluded = await person({ company: z });
    const blocked = await person();
    const ooo = await person();
    const far = await person({ city: 'milano' });
    const notAttending = await person();
    for (const u of [a, colleagueOs, colleague, excluded, blocked, ooo, far])
      await attend(u, offsite);
    await f.exclude(a, z);
    await f.block(blocked, a);
    await pool.query('update profiles set ooo_since = now() where user_id = $1', [ooo]);
    const feed = await offsiteFeed(a, offsite);
    const ids = (feed.body.cards as { id: string; distance?: string }[]).map((c) => c.id).sort();
    expect(ids).toEqual([colleagueOs, far].sort());
    expect((feed.body.cards as object[]).every((c) => !('distance' in c))).toBe(true);
    expect(feed.body.openSpaceEnabled).toBe(true);
    expect(ids).not.toContain(notAttending);
  });

  it('RC-174 non iscritto, oltre 24 ore dopo la fine o offsite annullato: come inesistente', async () => {
    const offsite = await fx.offsite();
    const a = await person();
    const b = await person();
    await attend(b, offsite);
    const missing = await offsiteFeed(a, '00000000-0000-4000-8000-000000000000', 404);
    const notJoined = await offsiteFeed(a, offsite, 404);
    expect(notJoined.body).toEqual(missing.body);
    await t
      .api()
      .post('/swipes')
      .set(bearer(await t.token(a)))
      .send({ userId: b, type: 'like', offsiteId: offsite })
      .expect(404);
    await attend(a, offsite);
    await offsiteFeed(a, offsite);
    await pool.query(
      "update offsites set starts_at = now() - interval '50 hours', ends_at = now() - interval '25 hours' where id = $1",
      [offsite],
    );
    await offsiteFeed(a, offsite, 404);
    const other = await fx.offsite();
    await attend(a, other);
    await pool.query(
      "update offsites set status = 'cancelled', cancelled_at = now() where id = $1",
      [other],
    );
    await offsiteFeed(a, other, 404);
  });

  it('RC-175 e RC-190 solo il numero arrotondato: meno di 10, poi la decina per difetto', async () => {
    const offsite = await fx.offsite();
    const people: string[] = [];
    for (let i = 0; i < 30; i++) people.push(await person());
    const rounded: number[] = [];
    for (const [index, u] of people.entries()) {
      const res = await attend(u, offsite);
      expect(JSON.stringify(res.body)).not.toMatch(/attendees"|"count"/);
      if ([6, 9, 26, 29].includes(index)) rounded.push(res.body.attendeesRounded);
    }
    expect(rounded).toEqual([0, 10, 20, 30]);
    const list = await t
      .api()
      .get('/offsites')
      .set(bearer(await t.token(people[0]!)))
      .expect(200);
    expect(list.body[0]).toMatchObject({ id: offsite, attendeesRounded: 30, attending: true });
    expect(JSON.stringify(list.body)).not.toMatch(new RegExp(people.slice(1).join('|')));
  });

  it('RC-176 capienza mai superata, anche con iscrizioni simultanee; approvazione e tipo', async () => {
    const offsite = await fx.offsite({ capacity: 3 });
    const people: string[] = [];
    for (let i = 0; i < 6; i++) people.push(await person());
    const results = await Promise.all(
      people.map(
        async (u) =>
          (
            await t
              .api()
              .put(`/offsites/${offsite}/attendance`)
              .set(bearer(await t.token(u)))
          ).status,
      ),
    );
    expect(results.filter((s) => s === 200)).toHaveLength(3);
    const { rows } = await pool.query('select count(*)::int as n from offsite_attendees');
    expect(rows[0].n).toBe(3);
    const open = await fx.offsite();
    const pending = await f.user(await f.company(), { status: 'pending_approval' });
    await fx.profile(pending);
    await attend(pending, open, 404);
    expect(
      await sqlState(() =>
        pool.query('insert into offsite_attendees (offsite_id, user_id) values ($1, $2)', [
          open,
          pending,
        ]),
      ),
    ).toBe('SSC13');
    const demo = await fx.offsite({ isDemo: true });
    await attend(people[0]!, demo, 404);
  });

  it("RC-176 disiscrizione dopo un match nato all'offsite: il match resta", async () => {
    const offsite = await fx.offsite();
    const a = await person();
    const b = await person();
    await attend(a, offsite);
    await attend(b, offsite);
    const m = await f.match(a, b);
    await t
      .api()
      .delete(`/offsites/${offsite}/attendance`)
      .set(bearer(await t.token(a)))
      .expect(204);
    const { rows } = await pool.query('select status from matches where id = $1', [m]);
    expect(rows[0].status).toBe('active');
    await offsiteFeed(a, offsite, 404);
  });

  it('RC-177 riga "sarò all\'offsite": spenta di base, visibile solo a chi vede il profilo', async () => {
    const offsite = await fx.offsite();
    const a = await person();
    const b = await person();
    await attend(b, offsite);
    const token = await t.token(a);
    expect(
      (await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(200)).body.offsites,
    ).toEqual([]);
    await t
      .api()
      .patch(`/offsites/${offsite}/attendance`)
      .set(bearer(await t.token(b)))
      .send({ showOnProfile: true })
      .expect(200);
    const deck = await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(200);
    expect(deck.body.offsites[0]).toMatchObject({
      offsiteId: offsite,
      title: 'Aperitivo di fine quarter',
      city: 'Milano',
    });
    await pool.query(
      "update offsites set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 hour' where id = $1",
      [offsite],
    );
    expect(
      (await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(200)).body.offsites,
    ).toEqual([]);
  });
});
