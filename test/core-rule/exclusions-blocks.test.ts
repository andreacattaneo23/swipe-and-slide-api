// Suite RC: aziende escluse (D175, D176, D186) e blocchi (D70, D108).
import { Pool } from 'pg';
import { Factory } from '../support/factory';
import { Rule, sqlState } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
const f = new Factory(pool);
const rule = new Rule(pool);

beforeEach(() => truncateAll(pool));
afterAll(() => pool.end());

const companyOf = async (userId: string): Promise<string> =>
  (await pool.query<{ company_id: string }>('select company_id from users where id = $1', [userId]))
    .rows[0]!.company_id;

const requestChange = (userId: string, companyId: string, operation: 'add' | 'remove') =>
  pool.query(
    `insert into excluded_company_changes (user_id, company_id, operation, effective_at)
     values ($1, $2, $3, now() + interval '30 hours')`,
    [userId, companyId, operation],
  );

describe('Aziende escluse (D175)', () => {
  it("RC-57 A esclude l'azienda di B: can_see falsa nei due sensi, like e match impossibili", async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    await f.exclude(a, await companyOf(b));
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    expect(await sqlState(() => f.like(b, a))).toBe('SSC01');
    expect(await sqlState(() => f.match(a, b))).toBe('SSC01');
  });

  it('RC-191 esclusione in registrazione e dalle impostazioni: simmetrica per ogni coppia', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const c = await f.user(await f.company());
    await f.exclude(a, await companyOf(b), 'registration');
    await requestChange(b, await companyOf(c), 'add');
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    // In attesa nulla cambia; all'efficacia (processo orario) B e C non si vedono
    expect((await rule.seeEachOther(b, c)).interact).toBe(true);
    await f.exclude(b, await companyOf(c));
    expect(await rule.seeEachOther(b, c)).toEqual({ ab: false, ba: false, interact: false });
  });

  it('RC-40 e RC-192 aziende non ammesse: la propria, unita, di altro tipo, inesistente', async () => {
    const x = await f.company();
    const a = await f.user(x);
    const merged = await f.company();
    await pool.query("update companies set status = 'merged' where id = $1", [merged]);
    const demo = await f.company({ isDemo: true });
    for (const target of [x, merged, demo]) {
      expect(await sqlState(() => f.exclude(a, target))).toBe('SSC05');
      expect(await sqlState(() => requestChange(a, target, 'add'))).toBe('SSC05');
    }
    expect(
      await sqlState(() => f.exclude(a, '00000000-0000-4000-8000-000000000000')),
    ).not.toBeNull();
    const { rows } = await pool.query<{ n: number }>(
      'select (select count(*) from excluded_companies) + (select count(*) from excluded_company_changes) as n',
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('RC-124 sedicesima azienda esclusa, contando le aggiunte in attesa: rifiutata', async () => {
    const a = await f.user(await f.company());
    for (let i = 0; i < 14; i++) await f.exclude(a, await f.company(), 'registration');
    await requestChange(a, await f.company(), 'add');
    const sixteenth = await f.company();
    expect(await sqlState(() => f.exclude(a, sixteenth, 'registration'))).toBe('SSC05');
  });

  it("RC-124 un'azienda aggiunta non si toglie prima di 7 giorni", async () => {
    const a = await f.user(await f.company());
    const y = await f.company();
    await f.exclude(a, y);
    expect(await sqlState(() => requestChange(a, y, 'remove'))).toBe('SSC05');
    await pool.query(
      "update excluded_companies set effective_at = now() - interval '8 days' where user_id = $1",
      [a],
    );
    await requestChange(a, y, 'remove');
  });

  it('RC-69 sesta modifica in 30 giorni rifiutata; le annullate non contano', async () => {
    const a = await f.user(await f.company());
    const companies: string[] = [];
    for (let i = 0; i < 6; i++) companies.push(await f.company());
    for (let i = 0; i < 5; i++) await requestChange(a, companies[i]!, 'add');
    expect(await sqlState(() => requestChange(a, companies[5]!, 'add'))).toBe('SSC05');
    await pool.query(
      "update excluded_company_changes set status = 'cancelled', closed_at = now() where user_id = $1 and company_id = $2",
      [a, companies[0]],
    );
    await requestChange(a, companies[5]!, 'add');
  });

  it('RC-193 cambio azienda con 15 aziende già escluse: la lasciata entra oltre il massimo', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    for (let i = 0; i < 15; i++) await f.exclude(a, await f.company(), 'registration');
    await f.changeCompany(a, y);
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from excluded_companies where user_id = $1',
      [a],
    );
    expect(rows[0]!.n).toBe(16);
    await requestChange(a, x, 'remove');
  });

  it("RC-154 e RC-179 A torna in X che aveva escluso: X si toglie, decide l'Open space", async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(y);
    const b = await f.user(x, { openSpace: true });
    const c = await f.user(x);
    await f.exclude(a, x);
    await f.changeCompany(c, y);
    await f.changeCompany(a, x);
    const { rows } = await pool.query<{ company_id: string }>(
      'select company_id from excluded_companies where user_id = $1',
      [a],
    );
    expect(rows.map((row) => row.company_id)).not.toContain(x);
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    await f.setOpenSpace(a, true);
    expect((await rule.seeEachOther(a, b)).interact).toBe(true);
    expect((await rule.seeEachOther(a, c)).interact).toBe(false);
  });

  it('RC-184 e RC-195 le esclusioni riguardano aziende, non persone', async () => {
    const x = await f.company();
    const z = await f.company();
    const a = await f.user(x);
    const c = await f.user(x);
    await f.changeCompany(c, z);
    expect((await rule.seeEachOther(a, c)).interact).toBe(false);
    await pool.query('delete from excluded_companies where user_id = $1', [c]);
    expect((await rule.seeEachOther(a, c)).interact).toBe(true);
    await f.block(a, c);
    expect((await rule.seeEachOther(a, c)).interact).toBe(false);
  });

  it("RC-95 e RC-102 un'esclusione efficace non tocca il match esistente", async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const m = await f.match(a, b, { withMessageFrom: a });
    await f.exclude(a, await companyOf(b));
    expect((await rule.matchStatus(m)).status).toBe('active');
    expect(await rule.canWrite(b, m)).toBe(true);
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
  });

  it("RC-97 un like in attesa resta ma non diventa match dopo l'esclusione", async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    await f.like(b, a);
    await f.exclude(a, await companyOf(b));
    expect(await rule.likeExists(b, a)).toBe(true);
    expect(await sqlState(() => f.like(a, b))).toBe('SSC01');
    expect(await sqlState(() => f.match(a, b))).toBe('SSC01');
  });
});

describe('Blocchi (D70, D108)', () => {
  it('RC-107 il blocco vale nei due sensi, anche tra colleghi con Open space e chat avviata', async () => {
    const x = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x, { openSpace: true });
    const m = await f.match(a, b, { withMessageFrom: b });
    await f.block(a, b);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    expect(await rule.canWrite(b, m)).toBe(false);
    expect(await sqlState(() => f.message(m, b))).toBe('SSC01');
  });

  it('RC-108 dopo lo sblocco restano invisibili per 30 giorni, poi possono ricomparire', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    await f.block(a, b, 10);
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    await pool.query("update blocks set unblocked_at = now() - interval '31 days'");
    expect((await rule.seeEachOther(a, b)).interact).toBe(true);
  });

  it('RC-153 colleghi con Open space che avevano lavorato in W, W esclusa da A: visibili; blocco no', async () => {
    const w = await f.company();
    const x = await f.company();
    const a = await f.user(w);
    const b = await f.user(w);
    await f.changeCompany(a, x);
    await f.changeCompany(b, x);
    await f.setOpenSpace(a, true);
    await f.setOpenSpace(b, true);
    expect((await rule.seeEachOther(a, b)).interact).toBe(true);
    await f.block(a, b);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
  });
});
