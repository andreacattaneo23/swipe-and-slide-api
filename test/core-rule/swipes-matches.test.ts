// Suite RC: swipe, limiti, Rollback e match dall'API (D53, D54, D58–D62, D107, D152), con il
// ruolo `app_role` e i trigger della regola core. Notifiche ed eventi catturati in memoria.
import { Pool } from 'pg';
import { Factory } from '../support/factory';
import {
  bearer,
  createFeedChatApp,
  type FeedChatApp,
  FeedChatFixture,
  flush,
} from '../support/feed-chat';
import { Rule } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
const f = new Factory(pool);
const fx = new FeedChatFixture(pool);
const rule = new Rule(pool);
let t: FeedChatApp;

beforeAll(async () => {
  t = await createFeedChatApp(pool);
});
beforeEach(async () => {
  await truncateAll(pool);
  await fx.cities();
  t.push.sent.length = 0;
  t.events.length = 0;
});
afterAll(async () => {
  await t.close();
  await pool.end();
});

async function person(options: { company?: string; openSpace?: boolean; lastName?: string } = {}) {
  const id = await f.user(options.company ?? (await f.company()), {
    openSpace: options.openSpace ?? false,
  });
  await fx.profile(id, { lastName: options.lastName ?? null, firstName: 'Giulia' });
  return id;
}

async function swipe(
  from: string,
  to: string,
  type: 'like' | 'pass' | 'escalation',
  expected = 200,
  offsiteId?: string,
) {
  return t
    .api()
    .post('/swipes')
    .set(bearer(await t.token(from)))
    .send({ userId: to, type, ...(offsiteId ? { offsiteId } : {}) })
    .expect(expected);
}

const companyName = async (userId: string) =>
  (
    await pool.query<{ name: string }>(
      'select z.name from users u join companies z on z.id = u.company_id where u.id = $1',
      [userId],
    )
  ).rows[0]!.name;

describe('Swipe, limiti e Rollback (D53, D54, D62)', () => {
  it('RC-120 il 26° like è rifiutato; il bonus del primo messaggio dà 3 like in più, al massimo 3 volte', async () => {
    const me = await person();
    const others: string[] = [];
    for (let i = 0; i < 26; i++) others.push(await person());
    for (let i = 0; i < 25; i++) await swipe(me, others[i]!, 'like');
    const over = await swipe(me, others[25]!, 'like', 429);
    expect(over.body.error.code).toBe('feed.slides.finished');
    expect(await rule.likeExists(me, others[25]!)).toBe(false);
    // "Fuori scope" resta senza limiti
    await swipe(me, others[25]!, 'pass');
    // Bonus: primo messaggio in tre match nuovi, poi un quarto senza bonus
    const bonusMatches: string[] = [];
    for (let i = 0; i < 4; i++) bonusMatches.push(await f.match(me, await person()));
    const token = await t.token(me);
    let last: { bonusAwarded: boolean; todaySlides: { remaining: number; total: number } } | null =
      null;
    const awarded: boolean[] = [];
    for (const matchId of bonusMatches) {
      const res = await t
        .api()
        .post(`/matches/${matchId}/messages`)
        .set(bearer(token))
        .send({ text: 'Allineamento veloce?', clientMessageId: crypto.randomUUID() })
        .expect(200);
      last = res.body;
      awarded.push(res.body.bonusAwarded);
    }
    expect(awarded).toEqual([true, true, true, false]);
    expect(last!.todaySlides).toEqual({ remaining: 9, total: 34, escalationsRemaining: 1 });
  });

  it("RC-120 seconda escalation rifiutata; l'escalation non conta nelle 25 slide", async () => {
    const me = await person();
    const a = await person();
    const b = await person();
    const res = await swipe(me, a, 'escalation');
    expect(res.body.todaySlides).toEqual({ remaining: 25, total: 25, escalationsRemaining: 0 });
    const again = await swipe(me, b, 'escalation', 429);
    expect(again.body.error.code).toBe('action.escalation.used');
  });

  it("RC-120 Rollback solo dell'ultimo swipe senza match, con il contatore restituito, non a catena", async () => {
    const me = await person();
    const a = await person();
    const b = await person();
    await swipe(me, a, 'like');
    await swipe(me, b, 'like');
    const token = await t.token(me);
    await t.api().post('/swipes/rollback').set(bearer(token)).send({ userId: a }).expect(409);
    const done = await t
      .api()
      .post('/swipes/rollback')
      .set(bearer(token))
      .send({ userId: b })
      .expect(200);
    expect(done.body.todaySlides.remaining).toBe(24);
    expect(await rule.likeExists(me, b)).toBe(false);
    await t.api().post('/swipes/rollback').set(bearer(token)).send({ userId: a }).expect(409);
    // Dopo un match il Rollback non è possibile
    await swipe(b, me, 'like');
    const matched = await swipe(me, b, 'like');
    expect(matched.body.matched).toBe(true);
    await t.api().post('/swipes/rollback').set(bearer(token)).send({ userId: b }).expect(409);
  });

  it('RC-120 due like reciproci simultanei creano un solo match', async () => {
    const a = await person();
    const b = await person();
    const [ra, rb] = await Promise.all([swipe(a, b, 'like'), swipe(b, a, 'like')]);
    expect([ra.body.matched, rb.body.matched].filter(Boolean)).toHaveLength(1);
    const { rows } = await pool.query('select count(*)::int as n from matches');
    expect(rows[0].n).toBe(1);
  });

  it('RC-143 il budget di A cambia solo con i suoi swipe, i suoi Rollback e i suoi bonus', async () => {
    const a = await person();
    const b = await person();
    await swipe(b, a, 'like');
    const c = await person();
    await swipe(c, a, 'escalation');
    const feed = await t
      .api()
      .get('/feed')
      .set(bearer(await t.token(a)))
      .expect(200);
    expect(feed.body.todaySlides).toEqual({ remaining: 25, total: 25, escalationsRemaining: 1 });
    expect(JSON.stringify(feed.body)).not.toMatch(/likesReceived|received/);
    // L'escalation di C si vede sulla sua card, il like di B no (D53, D54)
    const cards = feed.body.cards as { id: string; escalation?: boolean }[];
    expect(cards.find((card) => card.id === b)).not.toHaveProperty('escalation');
    expect(cards.find((card) => card.id === c)?.escalation).toBe(true);
  });

  it('RC-115 nessuna notifica di like; escalation notificata solo con can_interact, senza nomi', async () => {
    const a = await person();
    const b = await person();
    await pool.query(
      "insert into devices (user_id, installation_id, push_token, platform) values ($1, 'install-0001', 'ExponentPushToken[b]', 'ios')",
      [b],
    );
    await swipe(a, b, 'like');
    expect(t.push.sent).toHaveLength(0);
    const c = await person();
    await swipe(c, b, 'escalation');
    expect(t.push.sent).toHaveLength(1);
    expect(t.push.sent[0]!.body).toBe("Hai ricevuto un'escalation");
    expect(JSON.stringify(t.push.sent[0])).not.toMatch(/Giulia|Azienda/);
  });

  it('RC-18 e RC-60 swipe verso un collega senza Open space reciproco: 404 e trigger', async () => {
    const x = await f.company();
    const a = await person({ company: x, openSpace: true });
    const b = await person({ company: x });
    await swipe(a, b, 'like', 404);
    expect(await rule.likeExists(a, b)).toBe(false);
  });
});

describe('Match (D30, D58–D62, D107)', () => {
  it("RC-63 Deal Closed! e GET /matches con cognome e nome dell'azienda, mai company_id", async () => {
    const a = await person({ lastName: 'Rossi' });
    const b = await person({ lastName: 'Verdi' });
    await swipe(a, b, 'like');
    const res = await swipe(b, a, 'like');
    expect(res.body.match).toMatchObject({
      lastName: 'Rossi',
      companyName: await companyName(a),
      deadlineAt: expect.any(String),
    });
    await flush();
    expect(
      t.events
        .filter((e) => e.event.type === 'match' && [a, b].includes(e.userId))
        .map((e) => e.userId)
        .sort(),
    ).toEqual([a, b].sort());
    const list = await t
      .api()
      .get('/matches')
      .set(bearer(await t.token(a)))
      .expect(200);
    expect(list.body.matches).toHaveLength(1);
    expect(list.body.matches[0]).toMatchObject({
      state: 'active',
      isNew: true,
      person: { lastName: 'Verdi', companyName: await companyName(b) },
    });
    const text = JSON.stringify(list.body);
    const ids = (
      await pool.query<{ company_id: string }>(
        'select company_id from users where id in ($1, $2)',
        [a, b],
      )
    ).rows.map((r) => r.company_id);
    for (const id of ids) expect(text).not.toContain(id);
    expect(text).not.toMatch(/close_reason|closeReason|@/);
  });

  it("RC-64 match chiuso: nessun dato dell'altra persona; match attivo: il nome segue l'azienda attuale", async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    const closed = await f.match(a, b);
    const active = await f.match(a, c);
    const token = await t.token(a);
    await t.api().post(`/matches/${closed}/close`).set(bearer(token)).expect(204);
    const y = await f.company();
    await f.changeCompany(c, y);
    const list = await t.api().get('/matches').set(bearer(token)).expect(200);
    const matches = list.body.matches as { id: string; person?: { companyName?: string } }[];
    const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
    expect(byId[closed]).toEqual({
      id: closed,
      state: 'unavailable',
      activityAt: expect.any(String),
    });
    expect(byId[active]?.person?.companyName).toBe(await companyName(c));
    await t.api().get(`/matches/${closed}`).set(bearer(token)).expect(404);
    // Dopo la chiusura non si ricompare nel feed per 30 giorni (D61)
    const feed = await t.api().get('/feed').set(bearer(token)).expect(200);
    expect((feed.body.cards as { id: string }[]).map((card) => card.id)).not.toContain(b);
  });

  it("RC-109 profilo di B dal feed e dal match, con l'esclusione efficace e con B sospeso", async () => {
    const z = await f.company();
    const a = await person();
    const b = await person({ company: z });
    const m = await f.match(a, b, { withMessageFrom: a });
    await f.exclude(a, z);
    const token = await t.token(a);
    await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(404);
    const fromMatch = await t.api().get(`/matches/${m}/profile`).set(bearer(token)).expect(200);
    expect(fromMatch.body.companyName).toBe(await companyName(b));
    await pool.query("update users set status = 'suspended' where id = $1", [b]);
    await t.api().get(`/matches/${m}/profile`).set(bearer(token)).expect(404);
    const paused = await t.api().get(`/matches/${m}`).set(bearer(token)).expect(200);
    expect(paused.body).toMatchObject({ state: 'paused', person: { firstName: 'Giulia' } });
    expect(paused.body.person).not.toHaveProperty('companyName');
  });

  it('RC-130 colleghi con la chat avviata: azienda e cognome nel match, nessuno swipe né feed', async () => {
    const x = await f.company();
    const a = await person();
    const b = await person({ company: x, lastName: 'Neri' });
    const m = await f.match(a, b, { withMessageFrom: a });
    await f.changeCompany(a, x);
    const token = await t.token(a);
    const match = await t.api().get(`/matches/${m}`).set(bearer(token)).expect(200);
    expect(match.body).toMatchObject({
      state: 'active',
      person: { lastName: 'Neri', companyName: await companyName(b) },
    });
    await swipe(a, b, 'like', 404);
    const feed = await t.api().get('/feed').set(bearer(token)).expect(200);
    expect(feed.body.cards).toEqual([]);
    await t.api().post(`/matches/${m}/close`).set(bearer(token)).expect(204);
    await pool.query("update matches set closed_at = now() - interval '40 days' where id = $1", [
      m,
    ]);
    const later = await t
      .api()
      .get('/feed')
      .set(bearer(await t.token(b)))
      .expect(200);
    expect(later.body.cards).toEqual([]);
  });

  it("D152 e RC-178 like dallo swipe dell'offsite: stesso budget, match normale con l'etichetta", async () => {
    const a = await person();
    const b = await person();
    const offsite = await fx.offsite();
    await pool.query(
      'insert into offsite_attendees (offsite_id, user_id) values ($1, $2), ($1, $3)',
      [offsite, a, b],
    );
    await swipe(a, b, 'like', 200, offsite);
    const res = await swipe(b, a, 'like', 200, offsite);
    expect(res.body.matched).toBe(true);
    expect(res.body.match.offsiteTitle).toBe('Aperitivo di fine quarter');
    expect(res.body.todaySlides.remaining).toBe(24);
  });

  it('D60 la persona che aveva messo il like prima riceve "Nuovo deal chiuso"', async () => {
    const a = await person();
    const b = await person();
    await pool.query(
      "insert into devices (user_id, installation_id, push_token, platform) values ($1, 'install-0002', 'ExponentPushToken[a]', 'android')",
      [a],
    );
    await swipe(a, b, 'like');
    await swipe(b, a, 'like');
    expect(t.push.sent.map((p: { body: string }) => p.body)).toEqual(['Nuovo deal chiuso']);
    expect(t.push.sent[0]!.data).toMatchObject({ type: 'new_match', matchId: expect.any(String) });
  });
});
