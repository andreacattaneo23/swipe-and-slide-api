// Suite RC: feed, profilo dal feed e swipe dell'API (D31, D49–D54, D81, D109, D137, D157, D168),
// su PostgreSQL reale con il ruolo `app_role`. I casi verificano chi compare e che cosa le
// risposte contengono, non la query.
import { Pool } from 'pg';
import { Factory } from '../support/factory';
import { bearer, createFeedChatApp, type FeedChatApp, FeedChatFixture } from '../support/feed-chat';
import { Rule } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
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
});
afterAll(async () => {
  await t.close();
  await pool.end();
});

/** Utente attivo con il profilo completo, in un'azienda nuova se non indicata. */
async function person(
  options: Parameters<FeedChatFixture['profile']>[1] & {
    company?: string;
    openSpace?: boolean;
  } = {},
) {
  const id = await f.user(options.company ?? (await f.company()), {
    openSpace: options.openSpace ?? false,
  });
  await fx.profile(id, options);
  return id;
}

async function feedOf(userId: string, query = '') {
  const res = await t
    .api()
    .get(`/feed${query}`)
    .set(bearer(await t.token(userId)))
    .expect(200);
  return res.body as {
    cards: Record<string, unknown>[];
    backlogEmpty: boolean;
    todaySlides: { remaining: number; total: number; escalationsRemaining: number };
    openSpaceEnabled?: boolean;
    state?: string;
  };
}

const ids = (feed: { cards: Record<string, unknown>[] }) =>
  feed.cards.map((card) => card.id).sort();

describe('Feed: solo visibilità reciproca e filtri del feed (D31, D51)', () => {
  it('RC-61 e RC-24 il feed di ogni utente dei dati di prova contiene solo persone con can_interact', async () => {
    const x = await f.company();
    const y = await f.company();
    const people = [
      await person({ company: x }),
      await person({ company: x }),
      await person({ company: x, openSpace: true }),
      await person({ company: x, openSpace: true }),
      await person({ company: y }),
      await person({ company: y, openSpace: true }),
      await person(),
    ];
    await f.exclude(
      people[4]!,
      people[6]! &&
        (await pool.query('select company_id from users where id = $1', [people[6]])).rows[0]
          .company_id,
    );
    await f.block(people[1]!, people[5]!);
    const pending = await f.user(x, { status: 'pending_approval' });
    await fx.profile(pending);
    for (const me of people) {
      const feed = await feedOf(me);
      for (const card of feed.cards) {
        expect(await rule.fn('can_interact', me, card.id as string)).toBe(true);
      }
      const expected: string[] = [];
      for (const other of [...people, pending]) {
        if (other !== me && (await rule.fn('can_interact', me, other))) expected.push(other);
      }
      expect(ids(feed)).toEqual(expected.sort());
    }
  });

  it('RC-01 e RC-144 colleghi senza Open space reciproco: mai nel feed nei due sensi', async () => {
    const x = await f.company();
    const a = await person({ company: x });
    const b = await person({ company: x, openSpace: true });
    expect(ids(await feedOf(a))).toEqual([]);
    expect(ids(await feedOf(b))).toEqual([]);
  });

  it('RC-146 colleghi con Open space reciproco: nel feed con il badge, che manca a tutti gli altri', async () => {
    const x = await f.company();
    const a = await person({ company: x, openSpace: true });
    const b = await person({ company: x, openSpace: true });
    const c = await person();
    const feedA = await feedOf(a);
    expect(feedA.openSpaceEnabled).toBe(true);
    const cardB = feedA.cards.find((card) => card.id === b)!;
    expect(cardB.openSpaceColleagues).toBe(true);
    const cardC = feedA.cards.find((card) => card.id === c)!;
    expect('openSpaceColleagues' in cardC).toBe(false);
    const feedC = await feedOf(c);
    expect(feedC.cards.every((card) => !('openSpaceColleagues' in card))).toBe(true);
    expect('openSpaceEnabled' in feedC).toBe(false);
  });

  it("RC-57 e RC-191 aziende escluse: nessuno dei due nel feed dell'altro, senza segnali", async () => {
    const x = await f.company();
    const a = await person();
    const b = await person({ company: x });
    await f.exclude(a, x);
    expect(ids(await feedOf(a))).toEqual([]);
    const feedB = await feedOf(b);
    expect(feedB).toEqual({ cards: [], backlogEmpty: true, todaySlides: feedB.todaySlides });
  });

  it('RC-136 generi non binari e "preferisco non dirlo" solo a chi cerca tutti, nei due sensi', async () => {
    const nb = await person({ gender: 'non_binary', interestedIn: 'everyone' });
    const seekingMen = await person({ gender: 'woman', interestedIn: 'men' });
    const seekingAll = await person({ gender: 'man', interestedIn: 'everyone' });
    const womanForWomen = await person({ gender: 'woman', interestedIn: 'women' });
    expect(ids(await feedOf(nb))).toEqual([seekingAll].sort());
    expect(ids(await feedOf(seekingMen))).toEqual([seekingAll]);
    expect(ids(await feedOf(seekingAll)).sort()).toEqual([nb, seekingMen].sort());
    expect(ids(await feedOf(womanForWomen))).toEqual([]);
  });

  it("D51 fascia d'età e distanza massima valgono nei due sensi", async () => {
    const young = await person({ birthDate: '2001-05-01', ageMin: 18, ageMax: 30 });
    const older = await person({ birthDate: '1980-05-01', ageMin: 18, ageMax: 60 });
    expect(ids(await feedOf(older))).toEqual([]);
    expect(ids(await feedOf(young))).toEqual([]);
    const milan = await person({ city: 'milano', maxDistance: 'km25' });
    const bergamo = await person({ city: 'bergamo', maxDistance: 'km100' });
    const monza = await person({ city: 'monza', maxDistance: 'km25' });
    expect(ids(await feedOf(bergamo))).not.toContain(milan); // 45 km: oltre i 25 di Milano
    expect(ids(await feedOf(milan))).toContain(monza);
  });

  it('RC-121 ordine diverso a ogni richiesta, nessun peso nelle risposte; Backlog vuoto uguale', async () => {
    const me = await person();
    const others: string[] = [];
    for (let i = 0; i < 12; i++) others.push(await person());
    const orders = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const feed = await feedOf(me);
      expect(feed.cards).toHaveLength(12);
      for (const card of feed.cards) {
        expect(Object.keys(card).sort()).toEqual(
          expect.arrayContaining(['age', 'firstName', 'id', 'photos']),
        );
        expect(card).not.toHaveProperty('weight');
        expect(card).not.toHaveProperty('score');
      }
      orders.add(feed.cards.map((card) => card.id).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
    const lonely = await person({ city: 'roma' });
    expect(await feedOf(lonely)).toEqual({
      cards: [],
      backlogEmpty: true,
      todaySlides: expect.any(Object),
    });
  });

  it('RC-137 profilo incompleto o in OOO: feed vuoto con il solo stato, profilo e swipe 404', async () => {
    const a = await person();
    const b = await person();
    await pool.query("update photos set status = 'pending_approval' where user_id = $1", [a]);
    const incomplete = await feedOf(a);
    expect(incomplete).toMatchObject({ cards: [], backlogEmpty: true, state: 'incomplete' });
    const token = await t.token(a);
    await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(404);
    await t.api().post('/swipes').set(bearer(token)).send({ userId: b, type: 'like' }).expect(404);
    await pool.query("update photos set status = 'approved' where user_id = $1", [a]);
    await pool.query('update profiles set ooo_since = now() where user_id = $1', [a]);
    expect(await feedOf(a)).toMatchObject({ cards: [], state: 'ooo' });
    expect(ids(await feedOf(b))).toEqual([]); // chi è in OOO non compare
  });
});

describe('Città, trasferte e fasce (D49, D57, D109)', () => {
  it('RC-134 comune piccolo mostrato come la città vicina: "Nella tua città", mai il suo nome', async () => {
    const a = await person({ city: 'pero' });
    const b = await person({ city: 'milano' });
    const d = await person({ city: 'settala' });
    const feed = await feedOf(a);
    expect(feed.cards.find((card) => card.id === b)?.distance).toBe('same_city');
    expect(feed.cards.find((card) => card.id === d)?.distance).toBe('same_city');
    expect(JSON.stringify(feed)).not.toMatch(/Pero|Settala|015170|015206/);
  });

  it('RC-114 card e profilo senza coordinate, km, città base, cognome né azienda', async () => {
    const a = await person();
    const b = await person({ city: 'monza', lastName: 'Rossi' });
    const feed = await feedOf(a);
    const card = feed.cards.find((item) => item.id === b)!;
    expect(card.distance).toBe('within_25');
    const profile = await t
      .api()
      .get(`/profiles/${b}`)
      .set(bearer(await t.token(a)))
      .expect(200);
    for (const body of [JSON.stringify(card), JSON.stringify(profile.body)]) {
      expect(body).not.toMatch(/lat|lon|km"|Monza|Rossi|company|lastName|birth|interestedIn/);
    }
  });

  it('RC-110 una trasferta non rende visibile un collega senza Open space né una persona esclusa', async () => {
    const x = await f.company();
    const z = await f.company();
    const a = await person({ company: x, city: 'milano' });
    const c = await person({ company: x, city: 'roma' });
    const d = await person({ company: z, city: 'roma' });
    await f.exclude(a, z);
    const visible = await person({ city: 'roma' });
    await fx.trip(a, 'roma', 2, 6);
    expect(ids(await feedOf(a))).toEqual([visible]);
    expect(ids(await feedOf(c))).not.toContain(a);
    expect(ids(await feedOf(d))).not.toContain(a);
  });

  it('D52 "In trasferta nella mia città": solo chi compare grazie a una sua trasferta, con il periodo', async () => {
    const a = await person({ city: 'roma' });
    const traveller = await person({ city: 'milano' });
    const local = await person({ city: 'roma' });
    await fx.trip(traveller, 'roma', 3, 9);
    const all = await feedOf(a);
    expect(ids(all)).toEqual([traveller, local].sort());
    const trips = await feedOf(a, '?filter=trips');
    expect(ids(trips)).toEqual([traveller]);
    expect(trips.cards[0]!.trip).toMatchObject({ city: 'Roma' });
    expect(trips.cards[0]).not.toHaveProperty('distance');
  });

  it('RC-135 deck: solo le trasferte nella finestra di 14 giorni, nessuna con il calendario nascosto', async () => {
    const a = await person({ city: 'milano' });
    const b = await person({ city: 'monza' });
    await fx.trip(b, 'roma', 10, 12);
    await fx.trip(b, 'bergamo', 40, 45);
    const token = await t.token(a);
    const deck = await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(200);
    expect(deck.body.trips).toHaveLength(1);
    expect(deck.body.trips[0].cityName).toBe('Roma');
    await pool.query('update profiles set show_calendar = false where user_id = $1', [b]);
    const hidden = await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(200);
    expect(hidden.body.trips).toEqual([]);
  });
});

describe('Profilo dal feed (D30, D104)', () => {
  it('RC-60 e RC-57 identificativo noto senza visibilità reciproca: 404 uguale a uno inesistente', async () => {
    const x = await f.company();
    const a = await person();
    const b = await person({ company: x });
    await f.exclude(a, x);
    const token = await t.token(a);
    const hidden = await t.api().get(`/profiles/${b}`).set(bearer(token)).expect(404);
    const missing = await t
      .api()
      .get('/profiles/00000000-0000-4000-8000-000000000000')
      .set(bearer(token))
      .expect(404);
    expect(hidden.body).toEqual(missing.body);
    await t.api().post('/swipes').set(bearer(token)).send({ userId: b, type: 'like' }).expect(404);
    expect(await rule.likeExists(a, b)).toBe(false);
    expect(t.push.sent).toHaveLength(0);
  });

  it("RC-62 e RC-22 profilo dal feed senza alcun campo dell'azienda né email", async () => {
    const a = await person();
    const b = await person({ lastName: 'Bianchi' });
    const res = await t
      .api()
      .get(`/profiles/${b}`)
      .set(bearer(await t.token(a)))
      .expect(200);
    expect(res.body).toMatchObject({ id: b, firstName: 'Persona', photos: expect.any(Array) });
    expect(JSON.stringify(res.body)).not.toMatch(/company|Bianchi|@|lastName/);
    // URL firmato di breve durata dell'archivio S3 (MinIO in locale, D240)
    expect(res.body.photos[0].url).toMatch(/X-Amz-Signature=/);
  });

  it('RC-126 e RC-166 foto in attesa di revisione mai restituite agli altri', async () => {
    const a = await person();
    const b = await person();
    await pool.query(
      `insert into photos (user_id, storage_key, position, status) values ($1, 'test/pending', 3, 'pending_approval')`,
      [b],
    );
    const res = await t
      .api()
      .get(`/profiles/${b}`)
      .set(bearer(await t.token(a)))
      .expect(200);
    expect(res.body.photos).toHaveLength(2);
  });

  it('RC-201 sessione di registrazione: feed e profili chiusi', async () => {
    const a = await person();
    const token = await t.token(a, 'approval');
    await t.api().get('/feed').set(bearer(token)).expect(403);
  });
});
