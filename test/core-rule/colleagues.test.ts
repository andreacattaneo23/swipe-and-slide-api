// Suite RC: colleghi, Open space reciproco, stati dell'account e account dimostrativi.
// PostgreSQL reale con le migrazioni della produzione; i casi verificano i risultati attesi.
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { CoreRuleService } from '../../src/core/core-rule/core-rule.service';
import * as schema from '../../src/infra/database/schema';
import { Factory } from '../support/factory';
import { Rule, sqlState } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
const f = new Factory(pool);
const rule = new Rule(pool);
const coreRule = new CoreRuleService(drizzle(pool, { schema }));

beforeEach(() => truncateAll(pool));
afterAll(() => pool.end());

const CORE_RULE = 'SSC01';

describe('Colleghi della stessa azienda (D2, D137)', () => {
  it('RC-01 stessa azienda e stesso dominio senza Open space: invisibili, like rifiutato dal trigger', async () => {
    const x = await f.company();
    const a = await f.user(x);
    const b = await f.user(x);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    expect(await coreRule.canInteract(a, b)).toBe(false);
    expect(await sqlState(() => f.like(a, b))).toBe(CORE_RULE);
    expect(await sqlState(() => f.like(b, a))).toBe(CORE_RULE);
  });

  it('RC-02 stessa azienda con domini diversi (.it e .com): come RC-01', async () => {
    const x = await f.company({ domain: 'modello.example' });
    await pool.query('insert into company_domains (domain, company_id) values ($1, $2)', [
      'modello-it.example',
      x,
    ]);
    const a = await f.user(x);
    const b = await f.user(x);
    await pool.query("update work_emails set domain = 'modello-it.example' where user_id = $1", [
      b,
    ]);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    expect(await sqlState(() => f.like(a, b))).toBe(CORE_RULE);
  });

  it('RC-06 aziende diverse, attivi, nessuna esclusione: visibili; like, match e chat consentiti', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: true, ba: true, interact: true });
    await f.like(a, b);
    const m = await f.match(a, b, { withMessageFrom: a });
    expect(await rule.canWrite(b, m)).toBe(true);
  });

  it('RC-07 uno dei due in ri-verifica: visibili e operativi (P5)', async () => {
    const a = await f.user(await f.company(), { status: 'reverifying' });
    const b = await f.user(await f.company());
    expect((await rule.seeEachOther(a, b)).interact).toBe(true);
    await f.like(a, b);
  });

  it('RC-08 uno dei due in sospeso: invisibile nei due sensi, messaggi bloccati, match congelato', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const m = await f.match(a, b, { withMessageFrom: a });
    await pool.query("update users set status = 'suspended' where id = $1", [b]);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    expect(await rule.canWrite(a, m)).toBe(false);
    expect(await sqlState(() => f.message(m, a))).toBe(CORE_RULE);
    expect((await rule.matchStatus(m)).status).toBe('active');
  });

  it('RC-09 uno dei due in registrazione o in approvazione: mai visibile', async () => {
    const x = await f.company();
    const active = await f.user(await f.company());
    for (const status of ['registering', 'pending_approval'] as const) {
      const other = await f.user(x, { status });
      expect(await rule.seeEachOther(active, other)).toEqual({
        ab: false,
        ba: false,
        interact: false,
      });
    }
  });

  it('RC-38 ex collega oggi nella stessa azienda di A, senza Open space reciproco: escluso nei due sensi', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(y);
    const b = await f.user(x);
    await f.changeCompany(b, y);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
  });
});

describe('Open space reciproco (D137, D139, D156)', () => {
  it('RC-144 nuovi account colleghi senza scelte: Open space spento, non si vedono', async () => {
    const x = await f.company();
    const a = await f.user(x);
    const b = await f.user(x);
    const { rows } = await pool.query<{ open_space: boolean }>(
      'select open_space from users where id in ($1, $2)',
      [a, b],
    );
    expect(rows.every((row) => !row.open_space)).toBe(true);
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    expect(await sqlState(() => f.match(a, b))).toBe(CORE_RULE);
  });

  it("RC-145 solo A attiva l'Open space, poi solo B: can_see falsa nei due sensi", async () => {
    const x = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    await f.setOpenSpace(a, false);
    await f.setOpenSpace(b, true);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
  });

  it("RC-146 colleghi entrambi con l'Open space: visibili, badge solo tra loro", async () => {
    const x = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x, { openSpace: true });
    const c = await f.user(x);
    const d = await f.user(await f.company(), { openSpace: true });
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: true, ba: true, interact: true });
    expect(await coreRule.openSpaceColleagues(a, b)).toBe(true);
    expect(await coreRule.openSpaceColleagues(a, c)).toBe(false);
    expect(await coreRule.openSpaceColleagues(a, d)).toBe(false);
    await f.like(a, b);
    const m = await f.match(a, b);
    await f.message(m, b);
    await f.invite(m, a, await f.city());
  });

  it('RC-158 dimostrativi della stessa azienda con Open space reciproco; reale e dimostrativo mai', async () => {
    const demo = await f.company({ isDemo: true });
    const a = await f.user(demo, { isDemo: true, openSpace: true });
    const b = await f.user(demo, { isDemo: true, openSpace: true });
    const real = await f.user(await f.company(), { openSpace: true });
    expect((await rule.seeEachOther(a, b)).interact).toBe(true);
    expect(await rule.seeEachOther(a, real)).toEqual({ ab: false, ba: false, interact: false });
  });

  it('RC-161 A in pending_approval: invisibile anche ai colleghi con Open space; trigger rifiuta', async () => {
    const x = await f.company();
    const a = await f.user(x, { status: 'pending_approval', openSpace: true });
    const b = await f.user(x, { openSpace: true });
    const c = await f.user(await f.company());
    for (const other of [b, c]) {
      expect(await rule.seeEachOther(a, other)).toEqual({ ab: false, ba: false, interact: false });
      expect(await sqlState(() => f.like(other, a))).toBe(CORE_RULE);
    }
  });

  it('RC-162 da pending_approval ad active senza revisione approvata: rifiutato da check_approval', async () => {
    const a = await f.user(await f.company(), { status: 'pending_approval' });
    expect(
      await sqlState(() => pool.query("update users set status = 'active' where id = $1", [a])),
    ).toBe('SSC03');
    const r = await f.user(await f.company(), { status: 'registering' });
    expect(
      await sqlState(() => pool.query("update users set status = 'active' where id = $1", [r])),
    ).toBe('SSC03');
  });

  it('RC-185 colleghi con Open space reciproco: blocco, sospeso, in approvazione restano vincoli', async () => {
    const x = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x, { openSpace: true });
    const c = await f.user(x, { openSpace: true });
    const d = await f.user(x, { openSpace: true, status: 'pending_approval' });
    await f.block(a, b);
    await f.sanction(c);
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    expect((await rule.seeEachOther(a, c)).interact).toBe(false);
    expect((await rule.seeEachOther(a, d)).interact).toBe(false);
    expect(await sqlState(() => f.exclude(a, x))).toBe('SSC05');
  });

  it('RC-201 account registering senza azienda: mai visibile, company_conflict vera, trigger rifiuta', async () => {
    const x = await f.company();
    const r = await f.user(null, { status: 'registering', withoutCompany: true });
    const colleague = await f.user(x, { openSpace: true });
    expect(await rule.seeEachOther(r, colleague)).toEqual({
      ab: false,
      ba: false,
      interact: false,
    });
    expect(await rule.fn('company_conflict', r, colleague)).toBe(true);
    expect(await sqlState(() => f.like(colleague, r))).toBe(CORE_RULE);
    expect(await sqlState(() => f.match(r, colleague))).toBe(CORE_RULE);
  });
});

describe('Account dimostrativi (D42)', () => {
  it('RC-85 dimostrativo e reale, in ogni direzione: mai visibili, inserimenti diretti rifiutati', async () => {
    const demo = await f.user(await f.company({ isDemo: true }), { isDemo: true });
    const real = await f.user(await f.company());
    expect(await rule.seeEachOther(demo, real)).toEqual({ ab: false, ba: false, interact: false });
    expect(await sqlState(() => f.like(demo, real))).toBe(CORE_RULE);
    expect(await sqlState(() => f.like(real, demo))).toBe(CORE_RULE);
    expect(await sqlState(() => f.match(demo, real))).toBe(CORE_RULE);
  });

  it('RC-86 dimostrativi della stessa azienda senza Open space no; di aziende diverse sì', async () => {
    const d1 = await f.company({ isDemo: true });
    const d2 = await f.company({ isDemo: true });
    const a = await f.user(d1, { isDemo: true });
    const b = await f.user(d1, { isDemo: true });
    const c = await f.user(d2, { isDemo: true });
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    expect((await rule.seeEachOther(a, c)).interact).toBe(true);
  });

  it("RC-88 tipo dell'account e dell'azienda non modificabili; azienda di tipo diverso rifiutata", async () => {
    const real = await f.company();
    const a = await f.user(real);
    expect(
      await sqlState(() => pool.query('update users set is_demo = true where id = $1', [a])),
    ).toBe('SSC04');
    expect(
      await sqlState(() => pool.query('update companies set is_demo = true where id = $1', [real])),
    ).toBe('SSC04');
    const demo = await f.company({ isDemo: true });
    expect(await sqlState(() => f.user(demo))).toBe('SSC04');
  });
});

describe('Proprietà su tutte le coppie dei dati di prova', () => {
  /** Dati di prova vari: colleghi con Open space di nessuno, uno o entrambi, stati, blocchi. */
  async function dataset(): Promise<string[]> {
    const x = await f.company();
    const y = await f.company();
    const z = await f.company();
    const demo = await f.company({ isDemo: true });
    const users = [
      await f.user(x),
      await f.user(x, { openSpace: true }),
      await f.user(x, { openSpace: true }),
      await f.user(y),
      await f.user(y, { openSpace: true }),
      await f.user(z, { status: 'reverifying' }),
      await f.user(z, { status: 'pending_approval' }),
      await f.user(z, { status: 'suspended' }),
      await f.user(demo, { isDemo: true }),
      await f.user(null, { status: 'registering', withoutCompany: true }),
    ];
    await f.block(users[3]!, users[5]!);
    await f.exclude(users[0]!, y);
    return users;
  }

  it('RC-105 e RC-160: simmetria, conflitto aziendale e Open space solo tra colleghi', async () => {
    const users = await dataset();
    const company = new Map<string, string | null>();
    for (const id of users) {
      const { rows } = await pool.query<{ company_id: string | null }>(
        'select company_id from users where id = $1',
        [id],
      );
      company.set(id, rows[0]!.company_id);
    }
    for (const a of users) {
      for (const b of users) {
        if (a === b) continue;
        const { ab, ba, interact } = await rule.seeEachOther(a, b);
        expect(ab).toBe(ba); // simmetrica con D175
        expect(interact).toBe(ab && ba);
        expect(await rule.fn('mutual_open_space', a, b)).toBe(
          await rule.fn('mutual_open_space', b, a),
        );
        if (await rule.fn('company_conflict', a, b)) expect(interact).toBe(false);
        if (ab && company.get(a) === company.get(b)) {
          expect(await rule.fn('mutual_open_space', a, b)).toBe(true);
        }
      }
    }
  });

  it("RC-160 tra aziende diverse cambiare l'Open space non cambia can_see né company_conflict", async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const before = [await rule.canSee(a, b), await rule.fn('company_conflict', a, b)];
    await f.setOpenSpace(a, true);
    expect([await rule.canSee(a, b), await rule.fn('company_conflict', a, b)]).toEqual(before);
    await f.setOpenSpace(b, true);
    expect([await rule.canSee(a, b), await rule.fn('company_conflict', a, b)]).toEqual(before);
  });

  it('RC-24 coerenza degli strati: CoreRuleService e trigger degli swipe danno lo stesso esito', async () => {
    const users = await dataset();
    for (const a of users) {
      for (const b of users) {
        if (a === b) continue;
        const allowed = await coreRule.canInteract(a, b);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const state = await sqlState(() => f.like(a, b, client));
          expect(state === null).toBe(allowed);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      }
    }
  });
});
