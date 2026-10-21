// Integrazione delle impostazioni di privacy con PostgreSQL reale e il ruolo `app_role`: Open
// space dell'utente, aziende escluse con il ritardo e i limiti, blocchi. Casi RC-67, RC-68,
// RC-69, RC-74, RC-76, RC-95, RC-96, RC-107, RC-108, RC-124, RC-152, RC-186, RC-189, RC-192.
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ExcludedCompaniesService } from '../../src/domain/excluded-companies/excluded-companies.service';
import { Factory } from '../support/factory';
import { bearer, completeProfile, seedCities, signIn } from '../support/profile-support';
import { Rule } from '../support/rule';
import { createTestApp } from '../support/test-app';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
const f = new Factory(pool);
const rule = new Rule(pool);
let app: INestApplication<App>;

beforeAll(async () => {
  ({ app } = await createTestApp('app', undefined, { realEmail: true }));
});

beforeEach(async () => {
  await truncateAll(pool);
  await seedCities(pool);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const api = () => request(app.getHttpServer());

async function user(company: string, options: Parameters<Factory['user']>[1] = {}) {
  const id = await f.user(company, options);
  await completeProfile(pool, id);
  return { id, token: (await signIn(app, id)).token };
}

/** Porta nel passato la data di efficacia delle modifiche in attesa e applica il processo orario. */
async function applyDue() {
  await pool.query(`
    update excluded_company_changes
       set requested_at = requested_at - interval '48 hours', effective_at = effective_at - interval '48 hours'
     where status = 'pending'`);
  return app.get(ExcludedCompaniesService).applyDue();
}

describe('Open space dell’utente (D137–D140, D157)', () => {
  it('RC-186: stato e riepilogo dei soli filtri propri, attivazione con la versione del testo', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await user(x);
    const b = await user(y);
    await f.exclude(a.id, y);
    await f.block(a.id, b.id);
    const status = await api().get('/me/open-space').set(bearer(a.token)).expect(200);
    expect(status.body).toMatchObject({
      enabled: false,
      changesRemaining: 5,
      filters: { excludedCompanies: 1, blockedPeople: 1 },
    });
    await api().put('/me/open-space').set(bearer(a.token)).send({ enabled: true }).expect(400);
    const on = await api()
      .put('/me/open-space')
      .set(bearer(a.token))
      .send({ enabled: true, textVersion: 'conferma-1' })
      .expect(200);
    expect(on.body).toMatchObject({ enabled: true, changesRemaining: 4 });
    const { rows } = await pool.query(
      'select source, text_version from open_space_history where user_id = $1 order by changed_at desc limit 1',
      [a.id],
    );
    expect(rows[0]).toEqual({ source: 'user', text_version: 'conferma-1' });
  });

  it('RC-147, RC-148: lo spegnimento revoca il match senza messaggi tra colleghi, la chat avviata resta', async () => {
    const x = await f.company();
    const a = await user(x, { openSpace: true });
    const b = await user(x, { openSpace: true });
    const c = await user(x, { openSpace: true });
    const empty = await f.match(a.id, b.id);
    const chat = await f.match(a.id, c.id, { withMessageFrom: c.id });
    await api().put('/me/open-space').set(bearer(a.token)).send({ enabled: false }).expect(200);
    expect(await rule.matchStatus(empty)).toEqual({ status: 'closed', close_reason: 'colleagues' });
    expect((await rule.matchStatus(chat)).status).toBe('active');
    expect(await rule.canSee(a.id, b.id)).toBe(false);
  });

  it('RC-152: oltre 5 attivazioni in 30 giorni 429 con la data; lo spegnimento resta ammesso', async () => {
    const x = await f.company();
    const a = await user(x);
    // Contano tutte le modifiche dall'utente (5 ogni 30 giorni), ma si rifiuta solo l'attivazione
    for (let i = 0; i < 5; i++) {
      await api()
        .put('/me/open-space')
        .set(bearer(a.token))
        .send({ enabled: i % 2 === 0, textVersion: 'v1' })
        .expect(200);
    }
    await api().put('/me/open-space').set(bearer(a.token)).send({ enabled: false }).expect(200);
    const limited = await api()
      .put('/me/open-space')
      .set(bearer(a.token))
      .send({ enabled: true, textVersion: 'v1' })
      .expect(429);
    expect(limited.body.error.code).toBe('openSpace.limit.reached');
    expect(limited.body.error.date).toBeDefined();
    await api().put('/me/open-space').set(bearer(a.token)).send({ enabled: false }).expect(200);
  });

  it('RC-189: in approvazione le attivazioni hanno origine `approval` e non contano', async () => {
    const x = await f.company();
    const id = await f.user(x, { status: 'pending_approval' });
    const { token } = await signIn(app, id);
    await api()
      .put('/me/open-space')
      .set(bearer(token))
      .send({ enabled: true, textVersion: 'v1' })
      .expect(200);
    const status = await api().get('/me/open-space').set(bearer(token)).expect(200);
    expect(status.body.changesRemaining).toBe(5);
    const { rows } = await pool.query(
      "select count(*)::int as n from open_space_history where user_id = $1 and source = 'approval'",
      [id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe('Aziende escluse (D36, D39, D175, D186)', () => {
  it('RC-67, RC-76: aggiunta in attesa con la sola data massima, effettiva tra 24 e 47 ore', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await user(x);
    const added = await api()
      .put(`/settings/excluded-companies/${y}`)
      .set(bearer(a.token))
      .expect(202);
    expect(added.body.status).toBe('pending');
    const list = await api().get('/settings/excluded-companies').set(bearer(a.token)).expect(200);
    expect(list.body).toMatchObject({ companies: [], count: 1, max: 15, changesRemaining: 4 });
    expect(list.body.pending[0]).toMatchObject({ operation: 'add', company: { id: y } });
    expect(JSON.stringify(list.body)).not.toContain('effective');
    const { rows } = await pool.query<{ hours: number }>(
      'select extract(epoch from effective_at - requested_at) / 3600 as hours from excluded_company_changes',
    );
    expect(Number(rows[0]!.hours)).toBeGreaterThanOrEqual(24);
    expect(Number(rows[0]!.hours)).toBeLessThanOrEqual(47);
  });

  it('RC-68: annullare o chiedere l’opposto non ha effetti e non conta per il limite', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await user(x);
    const first = await api()
      .put(`/settings/excluded-companies/${y}`)
      .set(bearer(a.token))
      .expect(202);
    expect(first.body.status).toBe('pending');
    const opposite = await api()
      .delete(`/settings/excluded-companies/${y}`)
      .set(bearer(a.token))
      .expect(200);
    expect(opposite.body.status).toBe('cancelled');
    await api().put(`/settings/excluded-companies/${y}`).set(bearer(a.token)).expect(202);
    const list = await api().get('/settings/excluded-companies').set(bearer(a.token)).expect(200);
    await api()
      .delete(`/settings/excluded-company-changes/${list.body.pending[0].id}`)
      .set(bearer(a.token))
      .expect(204);
    const after = await api().get('/settings/excluded-companies').set(bearer(a.token)).expect(200);
    expect(after.body).toMatchObject({ pending: [], changesRemaining: 5 });
  });

  it('RC-69: la sesta modifica in 30 giorni è rifiutata con 429 e la data', async () => {
    const x = await f.company();
    const a = await user(x);
    for (let i = 0; i < 5; i++) {
      await api()
        .put(`/settings/excluded-companies/${await f.company()}`)
        .set(bearer(a.token))
        .expect(202);
    }
    const sixth = await api()
      .put(`/settings/excluded-companies/${await f.company()}`)
      .set(bearer(a.token))
      .expect(429);
    expect(sixth.body.error.code).toBe('excluded.changeLimit');
    expect(sixth.body.error.date).toBeDefined();
    expect(
      Number((await pool.query('select count(*) from excluded_company_changes')).rows[0].count),
    ).toBe(5);
  });

  it('RC-40, RC-192: la propria azienda, un’azienda dimostrativa o inesistente non si aggiungono', async () => {
    const x = await f.company();
    const demo = await f.company({ isDemo: true });
    const a = await user(x);
    for (const target of [x, demo, '00000000-0000-4000-8000-000000000000']) {
      const response = await api()
        .put(`/settings/excluded-companies/${target}`)
        .set(bearer(a.token))
        .expect(422);
      expect(response.body.error.code).toBe('excludedCompanies.invalid');
    }
    expect(
      Number((await pool.query('select count(*) from excluded_company_changes')).rows[0].count),
    ).toBe(0);
  });

  it('RC-124: massimo 15 contando le aggiunte in attesa; 7 giorni prima di togliere', async () => {
    const x = await f.company();
    const a = await user(x);
    for (let i = 0; i < 15; i++) await f.exclude(a.id, await f.company());
    const sixteenth = await api()
      .put(`/settings/excluded-companies/${await f.company()}`)
      .set(bearer(a.token))
      .expect(422);
    expect(sixteenth.body.error.code).toBe('excluded.error.max');
    const { rows } = await pool.query<{ company_id: string }>(
      'select company_id from excluded_companies where user_id = $1 limit 1',
      [a.id],
    );
    const early = await api()
      .delete(`/settings/excluded-companies/${rows[0]!.company_id}`)
      .set(bearer(a.token))
      .expect(422);
    expect(early.body.error.code).toBe('excluded.removableFrom');
  });

  it('RC-95, RC-96: alla data di efficacia cambia il feed, i match restano', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await user(x);
    const b = await user(y);
    const match = await f.match(a.id, b.id);
    await api().put(`/settings/excluded-companies/${y}`).set(bearer(a.token)).expect(202);
    expect(await rule.canSee(b.id, a.id)).toBe(true);
    expect(await applyDue()).toMatchObject({ applied: 1 });
    expect(await rule.canSee(b.id, a.id)).toBe(false);
    expect(await rule.canSee(a.id, b.id)).toBe(false);
    expect((await rule.matchStatus(match)).status).toBe('active');
    await pool.query("update excluded_companies set effective_at = now() - interval '8 days'");
    await api().delete(`/settings/excluded-companies/${y}`).set(bearer(a.token)).expect(202);
    expect(await rule.canSee(a.id, b.id)).toBe(false);
    await applyDue();
    expect(await rule.canSee(a.id, b.id)).toBe(true);
  });

  it('RC-74, RC-189: in approvazione le modifiche valgono subito e non contano', async () => {
    const x = await f.company();
    const y = await f.company();
    const id = await f.user(x, { status: 'pending_approval' });
    const { token } = await signIn(app, id);
    const added = await api()
      .put(`/settings/excluded-companies/${y}`)
      .set(bearer(token))
      .expect(200);
    expect(added.body.status).toBe('applied');
    const list = await api().get('/settings/excluded-companies').set(bearer(token)).expect(200);
    expect(list.body).toMatchObject({ immediate: true, changesRemaining: 5, pending: [] });
    expect(list.body.companies[0]).toMatchObject({ id: y });
    const removed = await api()
      .delete(`/settings/excluded-companies/${y}`)
      .set(bearer(token))
      .expect(200);
    expect(removed.body.status).toBe('applied');
  });
});

describe('Blocchi (D70)', () => {
  it('RC-107: chiude il match, cancella i like nei due sensi, nessuno vede l’altro', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await user(x);
    const b = await user(y);
    const c = await user(y);
    const match = await f.match(a.id, b.id, { withMessageFrom: b.id });
    await f.like(c.id, a.id);
    await f.like(a.id, c.id);
    await api().post('/blocks').set(bearer(a.token)).send({ userId: b.id }).expect(204);
    expect(await rule.matchStatus(match)).toEqual({ status: 'closed', close_reason: 'blocked' });
    expect(await rule.seeEachOther(a.id, b.id)).toEqual({ ab: false, ba: false, interact: false });
    await api().post('/blocks').set(bearer(a.token)).send({ userId: c.id }).expect(204);
    expect(await rule.likeExists(c.id, a.id)).toBe(false);
    expect(await rule.likeExists(a.id, c.id)).toBe(false);
    const list = await api().get('/blocks').set(bearer(a.token)).expect(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toEqual({
      userId: expect.any(String),
      firstName: 'Persona',
      photoUrl: expect.stringContaining('http'),
    });
  });

  it('RC-60: non si blocca chi non si vede né ha un match, con il 404 neutro', async () => {
    const x = await f.company();
    const a = await user(x);
    const b = await user(x);
    await api().post('/blocks').set(bearer(a.token)).send({ userId: b.id }).expect(404);
  });

  it('RC-108: lo sblocco non riapre nulla e la riga vale ancora 30 giorni', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await user(x);
    const b = await user(y);
    const match = await f.match(a.id, b.id);
    await api().post('/blocks').set(bearer(a.token)).send({ userId: b.id }).expect(204);
    await api().delete(`/blocks/${b.id}`).set(bearer(a.token)).expect(204);
    expect((await api().get('/blocks').set(bearer(a.token)).expect(200)).body).toEqual([]);
    expect((await rule.matchStatus(match)).status).toBe('closed');
    expect(await rule.canSee(a.id, b.id)).toBe(false);
    await pool.query("update blocks set unblocked_at = now() - interval '31 days'");
    expect(await rule.canSee(a.id, b.id)).toBe(true);
  });
});
