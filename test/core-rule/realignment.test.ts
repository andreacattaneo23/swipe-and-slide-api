// Suite RC: revoca tra chi diventa collega (cambio azienda e spegnimento dell'Open space),
// chat avviate che restano, trigger differito e ultima difesa sulle scritture dirette.
import { Pool } from 'pg';
import { Factory } from '../support/factory';
import { Rule, sqlState } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
const f = new Factory(pool);
const rule = new Rule(pool);

beforeEach(() => truncateAll(pool));
afterAll(() => pool.end());

describe('Cambio azienda (D9, D59, D176)', () => {
  it('RC-11 A cambia dominio restando nella stessa azienda: nessun effetto su match e like', async () => {
    const x = await f.company({ domain: 'gruppo.example' });
    await pool.query(
      "insert into company_domains (domain, company_id) values ('gruppo-it.example', $1)",
      [x],
    );
    const a = await f.user(x);
    const b = await f.user(await f.company());
    const m = await f.match(a, b);
    await f.like(a, await f.user(await f.company()));
    await pool.query("update work_emails set domain = 'gruppo-it.example' where user_id = $1", [a]);
    expect((await rule.matchStatus(m)).status).toBe('active');
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: true, ba: true, interact: true });
  });

  it("RC-92 A entra nell'azienda di B con la chat avviata: il match resta, niente feed né nuovi swipe", async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const b = await f.user(y);
    const m = await f.match(a, b, { withMessageFrom: b });
    await f.changeCompany(a, y);
    expect((await rule.matchStatus(m)).status).toBe('active');
    expect(await rule.canWrite(a, m)).toBe(true);
    expect(await rule.canWrite(b, m)).toBe(true);
    await f.message(m, a);
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    expect(await sqlState(() => f.like(a, b))).toBe('SSC01');
  });

  it("RC-93 A entra nell'azienda di B senza messaggi: match revocato, inviti chiusi, like cancellati", async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const b = await f.user(y);
    const c = await f.user(y);
    const m = await f.match(a, b);
    await f.invite(m, a, await f.city());
    await f.like(a, c);
    await f.like(c, a);
    await f.changeCompany(a, y);
    expect(await rule.matchStatus(m)).toEqual({ status: 'closed', close_reason: 'colleagues' });
    const { rows } = await pool.query<{ status: string }>(
      'select status from invites where match_id = $1',
      [m],
    );
    expect(rows[0]!.status).toBe('closed');
    expect(await rule.likeExists(a, c)).toBe(false);
    expect(await rule.likeExists(c, a)).toBe(false);
  });

  it('RC-131 con il solo invito la chat non è avviata e il match si revoca; con un messaggio resta', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const b = await f.user(y);
    const d = await f.user(x);
    const m1 = await f.match(a, b);
    await f.invite(m1, a, await f.city());
    const m2 = await f.match(d, b, { withMessageFrom: b });
    await f.changeCompany(a, y);
    await f.changeCompany(d, y);
    expect((await rule.matchStatus(m1)).status).toBe('closed');
    expect((await rule.matchStatus(m2)).status).toBe('active');
  });

  it("RC-12 A lascia X: X entra subito tra le escluse; tolta X, gli ex colleghi tornano dopo l'efficacia", async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const exColleague = await f.user(x);
    await f.changeCompany(a, y);
    expect((await rule.seeEachOther(a, exColleague)).interact).toBe(false);
    // Rimozione dell'azienda lasciata: accettata subito, senza i 7 giorni, con il ritardo normale
    await pool.query(
      `insert into excluded_company_changes (user_id, company_id, operation, effective_at)
       values ($1, $2, 'remove', now() + interval '30 hours')`,
      [a, x],
    );
    expect((await rule.seeEachOther(a, exColleague)).interact).toBe(false);
    // Applicazione della modifica (processo orario)
    await pool.query('delete from excluded_companies where user_id = $1 and company_id = $2', [
      a,
      x,
    ]);
    expect((await rule.seeEachOther(a, exColleague)).interact).toBe(true);
  });

  it('RC-100 cambio di azienda senza revoca: rifiutato al commit dal trigger differito', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const b = await f.user(y);
    const m = await f.match(a, b);
    expect(await sqlState(() => f.changeCompany(a, y, { skipRealign: true }))).toBe('SSC02');
    expect((await rule.matchStatus(m)).status).toBe('active');
    const { rows } = await pool.query<{ company_id: string }>(
      'select company_id from users where id = $1',
      [a],
    );
    expect(rows[0]!.company_id).toBe(x);
  });

  it("RC-100 applicare un'esclusione non richiede revoche e si conferma", async () => {
    const x = await f.company();
    const a = await f.user(x);
    const b = await f.user(await f.company());
    const m = await f.match(a, b);
    const y = (
      await pool.query<{ company_id: string }>('select company_id from users where id = $1', [b])
    ).rows[0]!.company_id;
    await f.exclude(a, y);
    expect((await rule.matchStatus(m)).status).toBe('active');
  });

  it('RC-196 cambio azienda che lascia la nuova azienda tra le escluse: rifiutato al commit', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    await f.exclude(a, y);
    expect(await sqlState(() => f.changeCompany(a, y, { keepNewCompanyExcluded: true }))).toBe(
      'SSC05',
    );
  });

  it('RC-123 nel cambio da X a Y con Y tra le escluse: X entra, Y si toglie', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    await f.exclude(a, y);
    await f.changeCompany(a, y);
    const { rows } = await pool.query<{ company_id: string; source: string }>(
      'select company_id, source from excluded_companies where user_id = $1',
      [a],
    );
    expect(rows).toEqual([{ company_id: x, source: 'company_change' }]);
  });

  it("RC-150 cambio azienda con l'Open space attivo: si spegne con origine company_change, fuori dal limite", async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(y, { openSpace: true });
    await f.changeCompany(a, y);
    const { rows } = await pool.query<{ open_space: boolean; open_space_prompt_at: Date | null }>(
      'select open_space, open_space_prompt_at from users where id = $1',
      [a],
    );
    expect(rows[0]!.open_space).toBe(false);
    expect(rows[0]!.open_space_prompt_at).not.toBeNull();
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
    const history = await pool.query<{ source: string }>(
      "select source from open_space_history where user_id = $1 and source = 'company_change'",
      [a],
    );
    expect(history.rowCount).toBe(1);
  });
});

describe("Spegnimento dell'Open space (D140)", () => {
  it('RC-147 B spegne: match senza messaggi revocato e like tra colleghi cancellati subito', async () => {
    const x = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x, { openSpace: true });
    const c = await f.user(x, { openSpace: true });
    const m = await f.match(a, b);
    await f.like(b, c);
    await f.like(c, b);
    await f.setOpenSpace(b, false);
    expect(await rule.matchStatus(m)).toEqual({ status: 'closed', close_reason: 'colleagues' });
    expect(await rule.likeExists(b, c)).toBe(false);
    expect(await rule.likeExists(c, b)).toBe(false);
    expect((await rule.seeEachOther(a, b)).interact).toBe(false);
  });

  it('RC-148 come RC-147 con la chat avviata: match e chat restano, nessun nuovo swipe', async () => {
    const x = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x, { openSpace: true });
    const m = await f.match(a, b, { withMessageFrom: a });
    await f.setOpenSpace(b, false);
    expect((await rule.matchStatus(m)).status).toBe('active');
    expect(await rule.canWrite(b, m)).toBe(true);
    await f.invite(m, b, await f.city());
    expect(await sqlState(() => f.like(a, b))).toBe('SSC01');
  });

  it("RC-149 scrittura diretta dell'Open space dal ruolo dell'API: rifiutata dai permessi", async () => {
    const a = await f.user(await f.company());
    const client = await pool.connect();
    try {
      await client.query('SET ROLE app_role');
      expect(
        await sqlState(() =>
          client.query(
            'update users set open_space = true, open_space_since = now() where id = $1',
            [a],
          ),
        ),
      ).toBe('42501');
      // Con set_open_space riesce, anche con lo stesso ruolo
      await client.query("select set_open_space($1, true, 'user', 'test')", [a]);
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });

  it('RC-149 spegnimento senza riallineamento con un ruolo che può scrivere: il commit fallisce', async () => {
    const x = await f.company();
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x, { openSpace: true });
    await f.match(a, b);
    expect(
      await sqlState(() =>
        pool.query('update users set open_space = false, open_space_since = null where id = $1', [
          b,
        ]),
      ),
    ).toBe('SSC02');
  });

  it('RC-152 sesta attivazione in 30 giorni rifiutata con la data; spegnimento sempre ammesso', async () => {
    const a = await f.user(await f.company());
    // Cinque modifiche (attivazioni e spegnimenti con origine `user`), poi lo spegnimento resta ammesso
    for (const enabled of [true, false, true, false, true]) {
      expect((await f.setOpenSpace(a, enabled)).result).toBe(enabled);
    }
    expect((await f.setOpenSpace(a, false)).result).toBe(false);
    const refused = await f.setOpenSpace(a, true);
    expect(refused.result).toBe(false);
    expect(refused.changeable_at).not.toBeNull();
    // Anche una scrittura diretta nello storico è rifiutata dal trigger
    expect(
      await sqlState(() =>
        pool.query(
          "insert into open_space_history (user_id, enabled, source) values ($1, true, 'user')",
          [a],
        ),
      ),
    ).toBe('SSC06');
    // La scelta in registrazione e lo spegnimento non contano
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from open_space_history where user_id = $1 and source = 'registration'",
      [a],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('RC-187 "Per ora no" in registrazione scrive comunque la riga dello storico', async () => {
    const a = await f.user(await f.company());
    const { rows } = await pool.query<{ enabled: boolean; source: string }>(
      'select enabled, source from open_space_history where user_id = $1',
      [a],
    );
    expect(rows).toEqual([{ enabled: false, source: 'registration' }]);
  });
});

describe('Ex colleghi e Open space (D158, D175, D176)', () => {
  it('RC-180 Luca e Giulia, ex colleghi in X e oggi in Y con Open space: visibili anche con X esclusa', async () => {
    const x = await f.company();
    const y = await f.company();
    const luca = await f.user(x);
    const giulia = await f.user(x);
    await f.changeCompany(luca, y);
    await f.changeCompany(giulia, y);
    await f.setOpenSpace(luca, true);
    await f.setOpenSpace(giulia, true);
    expect(await rule.seeEachOther(luca, giulia)).toEqual({ ab: true, ba: true, interact: true });
    expect(await rule.fn('exclusion_active', luca, giulia)).toBe(false);
    await f.like(luca, giulia);
    await f.match(luca, giulia);
  });

  it("RC-181 come RC-180 con l'Open space di uno solo: invisibili, like diretto rifiutato", async () => {
    const x = await f.company();
    const y = await f.company();
    const luca = await f.user(x);
    const giulia = await f.user(x);
    await f.changeCompany(luca, y);
    await f.changeCompany(giulia, y);
    await f.setOpenSpace(luca, true);
    expect((await rule.seeEachOther(luca, giulia)).interact).toBe(false);
    expect(await sqlState(() => f.like(giulia, luca))).toBe('SSC01');
  });

  it('RC-182 dopo RC-180 con un match senza messaggi Giulia passa in Z: il match resta, feed no', async () => {
    const x = await f.company();
    const y = await f.company();
    const z = await f.company();
    const luca = await f.user(x);
    const giulia = await f.user(x);
    await f.changeCompany(luca, y);
    await f.changeCompany(giulia, y);
    await f.setOpenSpace(luca, true);
    await f.setOpenSpace(giulia, true);
    const m = await f.match(luca, giulia);
    await f.changeCompany(giulia, z);
    expect((await rule.matchStatus(m)).status).toBe('active');
    expect((await rule.seeEachOther(luca, giulia)).interact).toBe(false);
  });

  it("RC-183 ex colleghi in aziende diverse: decide solo l'elenco delle escluse", async () => {
    const x = await f.company();
    const y = await f.company();
    const z = await f.company();
    const a = await f.user(x);
    const b = await f.user(x);
    await f.changeCompany(a, y);
    await f.changeCompany(b, z);
    expect((await rule.seeEachOther(a, b)).interact).toBe(true);
    await f.setOpenSpace(a, true);
    expect((await rule.seeEachOther(a, b)).interact).toBe(true);
    await f.exclude(a, z);
    expect(await rule.seeEachOther(a, b)).toEqual({ ab: false, ba: false, interact: false });
  });
});

describe('Ultima difesa e messaggi (D59, D107)', () => {
  it('RC-18 inserimento diretto di swipe, match, messaggio o invito vietati: errore del trigger', async () => {
    const x = await f.company();
    const a = await f.user(x);
    const b = await f.user(x);
    const c = await f.user(await f.company());
    expect(await sqlState(() => f.like(a, b))).toBe('SSC01');
    expect(await sqlState(() => f.match(a, b))).toBe('SSC01');
    const m = await f.match(a, c);
    await f.changeCompany(c, x);
    expect(await sqlState(() => f.message(m, a))).toBe('SSC01');
    expect(await sqlState(() => f.invite(m, a, '015146'))).not.toBeNull();
    const { rows } = await pool.query<{ n: number }>('select count(*)::int as n from swipes');
    expect(rows[0]!.n).toBe(0);
  });

  it('RC-106 can_write: falso in match chiuso, tra colleghi senza messaggi, con blocco; vero con chat', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const b = await f.user(y);
    const c = await f.user(y);
    const m1 = await f.match(a, b, { withMessageFrom: a });
    const m2 = await f.match(a, c);
    await pool.query(
      "update matches set status = 'closed', close_reason = 'closed_by_user', closed_at = now() where id = $1",
      [m2],
    );
    expect(await rule.canWrite(a, m2)).toBe(false);
    expect(await sqlState(() => f.message(m2, a))).toBe('SSC01');
    expect(await rule.canWrite(a, m1)).toBe(true);
    await f.block(b, a);
    expect(await rule.canWrite(a, m1)).toBe(false);
    expect(await sqlState(() => f.message(m1, a))).toBe('SSC01');
  });

  it('un match chiuso non torna attivo', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const m = await f.match(a, b);
    await pool.query(
      "update matches set status = 'closed', close_reason = 'expired', closed_at = now() where id = $1",
      [m],
    );
    expect(
      await sqlState(() =>
        pool.query(
          "update matches set status = 'active', close_reason = null, closed_at = null where id = $1",
          [m],
        ),
      ),
    ).toBe('SSC09');
  });
});
