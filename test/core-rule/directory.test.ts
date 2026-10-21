// Suite RC: operazioni dell'elenco delle aziende che toccano la regola core (P14, D59, D85, D94,
// D111, D175, D185, D186), controllo di coerenza (RC-125) e azzeramento dei dati dimostrativi
// (RC-89). Funzioni SQL con i privilegi del proprietario, su PostgreSQL vero.
import { Pool } from 'pg';
import { Factory } from '../support/factory';
import { Rule, sqlState } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
const f = new Factory(pool);
const rule = new Rule(pool);

beforeEach(() => truncateAll(pool));
afterAll(() => pool.end());

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await pool.query<T & Record<string, unknown>>(sql, params)).rows[0]!;

/** Seconda email della stessa azienda su un dominio in più, per spostarlo. */
async function addDomain(companyId: string, domain: string): Promise<void> {
  await pool.query('insert into company_domains (domain, company_id) values ($1, $2)', [
    domain,
    companyId,
  ]);
}

async function useDomain(userId: string, domain: string): Promise<void> {
  await pool.query('update work_emails set domain = $2 where user_id = $1 and status = $3', [
    userId,
    domain,
    'active',
  ]);
}

describe('Spostamento di un dominio e fusione (P14, D59, D94)', () => {
  it('RC-101 e RC-103 lo spostamento revoca i match senza messaggi tra nuovi colleghi, non quelli con la chat', async () => {
    const x = await f.company();
    const y = await f.company();
    await addDomain(x, 'sbagliato.example');
    const a = await f.user(x);
    const c = await f.user(x);
    await useDomain(a, 'sbagliato.example');
    await useDomain(c, 'sbagliato.example');
    const b = await f.user(y);
    const d = await f.user(y);
    const silent = await f.match(a, b);
    const talking = await f.match(c, d, { withMessageFrom: d });
    const before = await one<{ next: Date }>(
      "select next_reverification_at as next from work_emails where user_id = $1 and status = 'active'",
      [a],
    );
    const counts = await one<{ users_moved: number; matches_revoked: number }>(
      'select * from move_domain($1, $2)',
      ['sbagliato.example', y],
    );
    expect(counts).toMatchObject({ users_moved: 2, matches_revoked: 1 });
    expect(await rule.matchStatus(silent)).toEqual({
      status: 'closed',
      close_reason: 'colleagues',
    });
    expect((await rule.matchStatus(talking)).status).toBe('active');
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    // Non conta per D20 e non fa ripartire i 90 giorni; lo storico segue il dominio (D94)
    const change = await one<{ source: string }>(
      'select source from company_changes where user_id = $1',
      [a],
    );
    expect(change.source).toBe('domain_moved');
    const after = await one<{ next: Date }>(
      "select next_reverification_at as next from work_emails where user_id = $1 and status = 'active'",
      [a],
    );
    expect(after.next).toEqual(before.next);
    expect(
      await one('select company_id from company_domains where domain = $1', ['sbagliato.example']),
    ).toEqual({
      company_id: y,
    });
  });

  it("RC-150 chi cambia azienda per uno spostamento perde l'Open space, con la domanda; i colleghi che restano no", async () => {
    const x = await f.company();
    const y = await f.company();
    await addDomain(x, 'spostato.example');
    const a = await f.user(x, { openSpace: true });
    await useDomain(a, 'spostato.example');
    const b = await f.user(y, { openSpace: true });
    await pool.query('select * from move_domain($1, $2)', ['spostato.example', y]);
    const moved = await one<{ open_space: boolean; prompt: Date | null }>(
      'select open_space, open_space_prompt_at as prompt from users where id = $1',
      [a],
    );
    expect(moved.open_space).toBe(false);
    expect(moved.prompt).not.toBeNull();
    expect(
      (await one<{ open_space: boolean }>('select open_space from users where id = $1', [b]))
        .open_space,
    ).toBe(true);
    expect(await rule.seeEachOther(a, b)).toMatchObject({ interact: false });
    const history = await one<{ source: string; enabled: boolean }>(
      'select source, enabled from open_space_history where user_id = $1 order by changed_at desc limit 1',
      [a],
    );
    expect(history).toEqual({ source: 'company_change', enabled: false });
  });

  it("RC-82 e RC-194 nella fusione le esclusioni seguono l'azienda che resta; nessuna esclusione automatica", async () => {
    const x = await f.company();
    const y = await f.company();
    const z = await f.company();
    const a = await f.user(x);
    const yUser = await f.user(y);
    const c = await f.user(z);
    await f.exclude(c, x);
    await f.exclude(yUser, x);
    const counts = await one<{ users_moved: number }>('select * from merge_companies($1, $2)', [
      x,
      y,
    ]);
    expect(counts.users_moved).toBe(1);
    // C aveva escluso X: ora esclude Y, quindi nemmeno A
    const cExclusions = await pool.query(
      'select company_id from excluded_companies where user_id = $1',
      [c],
    );
    expect(cExclusions.rows).toEqual([{ company_id: y }]);
    expect(await rule.seeEachOther(a, c)).toMatchObject({ interact: false });
    // Chi lavora in Y e aveva escluso X: l'esclusione si toglie, con l'avviso
    expect(
      (await pool.query('select 1 from excluded_companies where user_id = $1', [yUser])).rowCount,
    ).toBe(0);
    expect(
      (
        await one<{ notice: Date | null }>(
          'select excluded_companies_notice_at as notice from users where id = $1',
          [yUser],
        )
      ).notice,
    ).not.toBeNull();
    // A non riceve l'azienda di prima tra le escluse (non è un cambio di lavoro, D186)
    expect(
      (await pool.query('select 1 from excluded_companies where user_id = $1', [a])).rowCount,
    ).toBe(0);
    expect(
      await one('select status, merged_into_company_id from companies where id = $1', [x]),
    ).toEqual({
      status: 'merged',
      merged_into_company_id: y,
    });
  });

  it('RC-88 fusioni e spostamenti tra aziende reali e dimostrative sono rifiutati dal database', async () => {
    const real = await f.company();
    const demo = await f.company({ isDemo: true });
    expect(
      await sqlState(() => pool.query('select * from merge_companies($1, $2)', [real, demo])),
    ).toBe('SSC14');
    await addDomain(real, 'reale.example');
    expect(
      await sqlState(() =>
        pool.query('select * from move_domain($1, $2)', ['reale.example', demo]),
      ),
    ).toBe('SSC14');
  });
});

describe('Rimozione di un dominio e di un’azienda (P14, D85, D111, D120, D185)', () => {
  it("RC-44 rimuovere il dominio dell'email attiva manda in ri-verifica, visibile e nella stessa azienda", async () => {
    const x = await f.company();
    await addDomain(x, 'rimosso.example');
    const a = await f.user(x);
    const b = await f.user(await f.company());
    await useDomain(a, 'rimosso.example');
    const affected = await one<{ n: number }>('select remove_domain($1) as n', ['rimosso.example']);
    expect(affected.n).toBe(1);
    const user = await one<{ status: string; company_id: string; reason: string }>(
      'select status, company_id, reverification_reason as reason from users where id = $1',
      [a],
    );
    expect(user).toEqual({ status: 'reverifying', company_id: x, reason: 'domain_removed' });
    expect(await rule.seeEachOther(a, b)).toMatchObject({ interact: true });
  });

  it("RC-132 l'avvio della rimozione nasconde subito gli utenti; l'annullamento riporta tutto com'era", async () => {
    const x = await f.company();
    const a = await f.user(x);
    const b = await f.user(await f.company());
    const m = await f.match(a, b, { withMessageFrom: b });
    await pool.query(
      `insert into sessions (user_id, refresh_hash, scope, sign_in_method, expires_at)
       values ($1, 'h', 'full', 'personal_email', now() + interval '1 day')`,
      [a],
    );
    expect((await one<{ n: number }>('select start_company_removal($1, 24) as n', [x])).n).toBe(1);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
    expect(await rule.canWrite(b, m)).toBe(false);
    expect(await sqlState(() => f.like(b, a))).toBe('SSC01');
    expect(
      (await one<{ scope: string }>('select scope from sessions where user_id = $1', [a])).scope,
    ).toBe('limited');
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from user_notices where template = 'company_removal.started'",
        )
      ).n,
    ).toBe(1);
    // Nessuna nuova email aziendale verso un'azienda non attiva
    expect(
      await sqlState(() =>
        pool.query(
          `insert into work_emails (user_id, company_id, domain, email, email_hash, verified_at, next_reverification_at)
           values ($1, $2, 'x.example', 'n@x.example', 'nuova', now(), now())`,
          [b, x],
        ),
      ),
    ).toBe('SSC08');
    await pool.query('select cancel_company_removal($1)', [x]);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: true, ba: true, interact: true });
    expect(await rule.canWrite(b, m)).toBe(true);
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int as n from user_notices where template = 'company_removal.cancelled'",
        )
      ).n,
    ).toBe(1);
  });

  it("RC-133 alla fine dell'intervallo gli account e l'azienda si cancellano, senza riferimento anonimo", async () => {
    const x = await f.company();
    const y = await f.company();
    const z = await f.company();
    const leaver = await f.user(x);
    await f.changeCompany(leaver, y);
    const stayer = await f.user(x);
    const c = await f.user(z);
    await f.exclude(c, x);
    await pool.query('select start_company_removal($1, 24)', [x]);
    await pool.query(
      "update companies set removal_final_at = now() - interval '1 minute', removal_started_at = now() - interval '1 day' where id = $1",
      [x],
    );
    expect(
      (await one<{ done: boolean }>('select finish_company_removal($1) as done', [x])).done,
    ).toBe(false);
    await pool.query('select delete_account($1)', [stayer]);
    expect(
      (await one<{ done: boolean }>('select finish_company_removal($1) as done', [x])).done,
    ).toBe(true);
    expect((await pool.query('select 1 from companies where id = $1', [x])).rowCount).toBe(0);
    const history = await pool.query<{
      company_id: string | null;
      domain: string | null;
      email_hash: string;
    }>(
      "select company_id, domain, email_hash from work_emails where user_id = $1 and status = 'historical'",
      [leaver],
    );
    expect(history.rows).toEqual([
      { company_id: null, domain: null, email_hash: expect.any(String) },
    ]);
    const changes = await pool.query(
      'select from_company_id from company_changes where user_id = $1',
      [leaver],
    );
    expect(changes.rows.every((row) => row.from_company_id === null)).toBe(true);
    expect(
      (await pool.query('select 1 from excluded_companies where user_id = $1', [c])).rowCount,
    ).toBe(0);
    // L'azienda lasciata, entrata nelle escluse del cambio, sparisce anche da lì
    expect(
      (await pool.query('select 1 from excluded_companies where user_id = $1', [leaver])).rowCount,
    ).toBe(0);
  });
});

describe('Controllo di coerenza e dati dimostrativi', () => {
  it('RC-125 corregge solo le anomalie inserite di proposito e lascia i casi ammessi', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const b = await f.user(x);
    const c = await f.user(x, { openSpace: true });
    const d = await f.user(x, { openSpace: true });
    const e = await f.user(y);
    const g = await f.user(x);
    const excluder = await f.user(await f.company());
    // Ammessi: chat avviata tra colleghi, colleghi con Open space reciproco, persone che si escludono
    const talking = await f.match(g, e, { withMessageFrom: e });
    const open = await f.match(c, d);
    const excluded = await f.match(excluder, e);
    await f.exclude(excluder, y);
    await f.changeCompany(e, x, { skipRealign: false });
    // Anomalia inserita saltando i trigger: match senza messaggi tra colleghi
    const client = await pool.connect();
    let anomaly: string;
    try {
      await client.query("set session_replication_role = 'replica'");
      const [first, second] = a < b ? [a, b] : [b, a];
      anomaly = (
        await client.query<{ id: string }>(
          'insert into matches (user_a_id, user_b_id) values ($1, $2) returning id',
          [first, second],
        )
      ).rows[0]!.id;
      await client.query("set session_replication_role = 'origin'");
    } finally {
      client.release();
    }
    const result = await one<{ r: Record<string, number> }>(
      'select check_core_rule_consistency() as r',
    );
    expect(result.r.conflictMatchesClosed).toBe(1);
    expect(result.r.realDemoInteractions).toBe(0);
    expect((await rule.matchStatus(anomaly)).close_reason).toBe('colleagues');
    expect((await rule.matchStatus(talking)).status).toBe('active');
    expect((await rule.matchStatus(open)).status).toBe('active');
    expect((await rule.matchStatus(excluded)).status).toBe('active');
    const again = await one<{ r: Record<string, number> }>(
      'select check_core_rule_consistency() as r',
    );
    expect(Object.values(again.r).every((value) => value === 0)).toBe(true);
  });

  it("RC-89 l'azzeramento tocca solo gli account dimostrativi e spegne l'Open space", async () => {
    const demoA = await f.company({ isDemo: true });
    const demoB = await f.company({ isDemo: true });
    const reviewer = await f.user(demoA, { isDemo: true, openSpace: true });
    const other = await f.user(demoB, { isDemo: true });
    const realA = await f.user(await f.company());
    const realB = await f.user(await f.company());
    await f.match(reviewer, other, { withMessageFrom: other });
    const real = await f.match(realA, realB);
    await pool.query('select reset_demo_data()');
    expect(
      (
        await pool.query('select 1 from matches where user_a_id = any($1) or user_b_id = any($1)', [
          [reviewer, other],
        ])
      ).rowCount,
    ).toBe(0);
    expect((await rule.matchStatus(real)).status).toBe('active');
    expect(
      (await one<{ open_space: boolean }>('select open_space from users where id = $1', [reviewer]))
        .open_space,
    ).toBe(false);
  });
});
