// Integrazione delle API di amministrazione con PostgreSQL reale e il ruolo `backoffice_role`:
// accesso degli operatori, aziende e domini, approvazioni e offsite.
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { CaptureEmailSender } from '../support/capture-email-sender';
import { Factory } from '../support/factory';
import { createTestApp } from '../support/test-app';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
const f = new Factory(pool);
let app: INestApplication<App>;
let email: CaptureEmailSender;

beforeAll(async () => {
  ({ app, email } = await createTestApp('admin'));
});

beforeEach(async () => {
  await truncateAll(pool);
  email.sent.length = 0;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const api = () => request(app.getHttpServer());
const count = async (sql: string, params: unknown[] = []) =>
  Number((await pool.query<{ n: string }>(sql, params)).rows[0]!.n);

/** Operatore di prova: accede con l'email e il codice (D244). */
async function operator(roles: string[] = ['admin', 'moderator', 'support']) {
  const address = `op-${roles.join('-')}-${Date.now()}@backoffice.example`;
  await pool.query('insert into operators (email, name, roles) values ($1, $2, $3)', [
    address,
    'Operatore',
    `{${roles.join(',')}}`,
  ]);
  return { address };
}

async function login(roles?: string[]): Promise<{ token: string }> {
  const op = await operator(roles);
  await api().post('/backoffice/auth/code').send({ email: op.address }).expect(202);
  const response = await api()
    .post('/backoffice/auth/verify')
    .send({
      email: op.address,
      code: email.lastCodeFor(op.address),
    })
    .expect(200);
  return { token: response.body.token as string };
}

const why = { explanation: 'Verifica del team' };

describe('Accesso degli operatori (D88, D231, D244)', () => {
  it('email e codice, senza TOTP; codice sbagliato 401 con i tentativi e un evento di sicurezza', async () => {
    const op = await operator();
    await api().post('/backoffice/auth/code').send({ email: op.address }).expect(202);
    const right = email.lastCodeFor(op.address)!;
    const wrong = await api()
      .post('/backoffice/auth/verify')
      .send({ email: op.address, code: right === '000000' ? '111111' : '000000' })
      .expect(401);
    expect(wrong.body.error).toEqual({ code: 'invalid_credentials', remainingAttempts: 4 });
    expect(
      await count("select count(*) as n from audit_log where action = 'operator_login_failed'"),
    ).toBe(1);
    // Il secondo fattore non c'è più: un campo `totp` non è ammesso
    await api()
      .post('/backoffice/auth/verify')
      .send({ email: op.address, code: right, totp: '123456' })
      .expect(400);
    await api()
      .post('/backoffice/auth/verify')
      .send({ email: op.address, code: right })
      .expect(200);
    const { token } = await login();
    const me = await api().get('/backoffice/auth/me').set('X-Operator-Token', token).expect(200);
    expect(me.body.roles).toEqual(['admin', 'moderator', 'support']);
  });

  it('indirizzo sconosciuto: stessa risposta, nessun codice', async () => {
    await api()
      .post('/backoffice/auth/code')
      .send({ email: 'nessuno@backoffice.example' })
      .expect(202);
    expect(email.sent).toHaveLength(0);
  });

  it('identità verificata a ogni richiesta: senza token, sessione revocata o operatore disattivato 401', async () => {
    await api().get('/backoffice/companies').expect(401);
    const { token } = await login();
    await api().get('/backoffice/companies').set('X-Operator-Token', token).expect(200);
    await pool.query("update operators set status = 'disabled'");
    await api().get('/backoffice/companies').set('X-Operator-Token', token).expect(401);
    await pool.query("update operators set status = 'active'");
    await api().post('/backoffice/auth/logout').set('X-Operator-Token', token).expect(204);
    await api().get('/backoffice/companies').set('X-Operator-Token', token).expect(401);
  });

  it('ruoli letti dal database: il Moderatore non gestisce le aziende ma vede le approvazioni', async () => {
    const { token } = await login(['moderator']);
    await api().get('/backoffice/companies').set('X-Operator-Token', token).expect(403);
    await api().get('/backoffice/approvals/queue').set('X-Operator-Token', token).expect(200);
    await api().get('/backoffice/offsites').set('X-Operator-Token', token).expect(403);
  });
});

describe('Aziende e domini (D23, D84, D91, D93)', () => {
  it('creazione, modifica, domini e cancellazione con audit e motivazione', async () => {
    const { token } = await login();
    const auth = { 'X-Operator-Token': token };
    const created = await api()
      .post('/backoffice/companies')
      .set(auth)
      .send({ name: 'Modello Partners', domains: ['ModelloPartners.example'], ...why })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Modello Partners',
      domains: ['modellopartners.example'],
      isDemo: false,
    });
    const id = created.body.id as string;
    await api()
      .post('/backoffice/companies')
      .set(auth)
      .send({ name: 'modello partners', domains: [], ...why })
      .expect(409);
    await api()
      .patch(`/backoffice/companies/${id}`)
      .set(auth)
      .send({ name: 'Modello Partners Italia', ...why })
      .expect(200);
    const domain = await api()
      .post(`/backoffice/companies/${id}/domains`)
      .set(auth)
      .send({ domain: 'it.modellopartners.example', ...why })
      .expect(201);
    expect(domain.body.domains).toEqual(['it.modellopartners.example', 'modellopartners.example']);
    await api()
      .delete(`/backoffice/companies/${id}/domains/it.modellopartners.example`)
      .set(auth)
      .send(why)
      .expect(200);
    await api()
      .delete(`/backoffice/companies/${id}`)
      .set(auth)
      .send({ ...why, confirmName: 'Altro nome' })
      .expect(400);
    await api()
      .delete(`/backoffice/companies/${id}`)
      .set(auth)
      .send({ ...why, confirmName: 'Modello Partners Italia' })
      .expect(204);
    const { rows } = await pool.query<{ action: string; explanation: string }>(
      "select action, explanation from audit_log where type = 'action' order by performed_at",
    );
    expect(rows.map((row) => row.action)).toEqual([
      'company_created',
      'company_updated',
      'domain_added',
      'domain_removed',
      'company_deleted',
    ]);
    expect(rows.every((row) => row.explanation === 'Verifica del team')).toBe(true);
  });

  it('RC-05 il backoffice non aggiunge provider personali né domini usa e getta; motivazione obbligatoria', async () => {
    const { token } = await login();
    const auth = { 'X-Operator-Token': token };
    for (const domain of ['gmail.com', 'mailinator.com']) {
      const response = await api()
        .post('/backoffice/companies')
        .set(auth)
        .send({ name: `Prova ${domain}`, domains: [domain], ...why })
        .expect(400);
      expect(response.body.error.code).toBe('company.domain.notAllowed');
    }
    await api()
      .post('/backoffice/companies')
      .set(auth)
      .send({ name: 'Senza motivo', domains: [] })
      .expect(400);
  });

  it("un'azienda con utenti non si cancella direttamente (serve la rimozione con intervallo)", async () => {
    const { token } = await login();
    const x = await f.company();
    await f.user(x);
    const { rows } = await pool.query<{ name: string }>(
      'select name from companies where id = $1',
      [x],
    );
    const response = await api()
      .delete(`/backoffice/companies/${x}`)
      .set('X-Operator-Token', token)
      .send({ ...why, confirmName: rows[0]!.name })
      .expect(409);
    expect(response.body.error.code).toBe('company.hasUsers');
  });
});

describe('Approvazioni (D141–D144)', () => {
  it('coda senza dati riservati; approvazione con audit: account attivo e foto approvate', async () => {
    const { token } = await login(['moderator']);
    const auth = { 'X-Operator-Token': token };
    const user = await f.user(await f.company(), { status: 'pending_approval' });
    await pool.query(
      "insert into photos (user_id, storage_key, position, status) values ($1, 'k1', 1, 'pending_approval')",
      [user],
    );
    const queue = await api().get('/backoffice/approvals/queue').set(auth).expect(200);
    expect(queue.body).toHaveLength(1);
    const item = queue.body[0] as Record<string, unknown>;
    expect(item).toMatchObject({ userId: user, attempt: 1, ageYears: expect.any(Number) });
    // RC-168: niente "chi ti interessa", data di nascita, email né Open space
    expect(Object.keys(item)).not.toEqual(expect.arrayContaining(['interestedIn']));
    expect(JSON.stringify(item)).not.toMatch(/interested|birth|open_?space|@/i);
    await api()
      .post(`/backoffice/approvals/${item.reviewId as string}/approval`)
      .set(auth)
      .send(why)
      .expect(204);
    const status = await pool.query<{ status: string }>('select status from users where id = $1', [
      user,
    ]);
    expect(status.rows[0]!.status).toBe('active');
    expect(await count("select count(*) as n from photos where status = 'approved'")).toBe(1);
    expect(
      await count("select count(*) as n from audit_log where action = 'profile_approved'"),
    ).toBe(1);
    await api()
      .post(`/backoffice/approvals/${item.reviewId as string}/approval`)
      .set(auth)
      .send(why)
      .expect(409);
  });

  it('RC-163 e RC-164 rifiuto con motivazione; al terzo rifiuto le due email sono bloccate', async () => {
    const { token } = await login(['moderator']);
    const auth = { 'X-Operator-Token': token };
    const user = await f.user(await f.company(), { status: 'pending_approval' });
    const reject = {
      reason: 'inappropriate_photos',
      userExplanation: 'Carica una foto in cui si vede il viso.',
      ...why,
    };
    await api().post(`/backoffice/approvals/x/rejection`).set(auth).send(reject).expect(400);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { rows } = await pool.query<{ id: string }>(
        "select id from profile_reviews where user_id = $1 and outcome = 'pending'",
        [user],
      );
      await api()
        .post(`/backoffice/approvals/${rows[0]!.id}/rejection`)
        .set(auth)
        .send({ ...reject, userExplanation: '' })
        .expect(400);
      const response = await api()
        .post(`/backoffice/approvals/${rows[0]!.id}/rejection`)
        .set(auth)
        .send(reject)
        .expect(200);
      expect(response.body).toEqual({ attempt, blocked: attempt === 3 });
      if (attempt < 3) {
        await pool.query(
          "insert into profile_reviews (user_id, attempt, due_at) values ($1, $2, now() + interval '1 day')",
          [user, attempt + 1],
        );
      }
    }
    const hashes = await pool.query<{ type: string; source: string }>(
      'select type, source from blocked_hashes order by type',
    );
    expect(hashes.rows).toEqual([
      { type: 'personal', source: 'third_rejection' },
      { type: 'work', source: 'third_rejection' },
    ]);
    expect(
      await count("select count(*) as n from audit_log where action = 'third_rejection_block'"),
    ).toBe(1);
  });
});

describe('Offsite (D150, D153, D167)', () => {
  it('bozza, modifica, pubblicazione e annullamento con il solo numero arrotondato', async () => {
    const { token } = await login(['admin']);
    const auth = { 'X-Operator-Token': token };
    const city = await f.city();
    const starts = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    const created = await api()
      .post('/backoffice/offsites')
      .set(auth)
      .send({
        title: 'Offsite di prova',
        description: 'Serata tra consulenti',
        venueName: 'Spazio',
        venueAddress: 'Via di prova 1',
        cityId: city,
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + 3 * 3600 * 1000).toISOString(),
        capacity: 100,
        ...why,
      })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ status: 'draft', attendeesRounded: 0 });
    expect(created.body).not.toHaveProperty('createdBy');
    await api()
      .patch(`/backoffice/offsites/${id}`)
      .set(auth)
      .send({ title: "Offsite d'autunno", ...why })
      .expect(200);
    await api().post(`/backoffice/offsites/${id}/publication`).set(auth).send(why).expect(201);
    // RC-190: 27 iscritti diventano 20, mai il numero esatto
    const company = await f.company();
    for (let i = 0; i < 27; i++) {
      const user = await f.user(company);
      await pool.query('insert into offsite_attendees (offsite_id, user_id) values ($1, $2)', [
        id,
        user,
      ]);
    }
    const read = await api().get(`/backoffice/offsites/${id}`).set(auth).expect(200);
    expect(read.body.attendeesRounded).toBe(20);
    // Nessun valore uguale al numero esatto (non si cerca la stringa: gli uuid contengono cifre)
    expect(Object.values(read.body as Record<string, unknown>)).not.toContain(27);
    const cancelled = await api()
      .post(`/backoffice/offsites/${id}/cancellation`)
      .set(auth)
      .send(why)
      .expect(201);
    expect(cancelled.body.status).toBe('cancelled');
    await api()
      .patch(`/backoffice/offsites/${id}`)
      .set(auth)
      .send({ title: 'Di nuovo', ...why })
      .expect(409);
    expect(await count("select count(*) as n from audit_log where object_type = 'offsite'")).toBe(
      4,
    );
  });

  it('tassonomie a tema dalle tabelle del profilo: voce spenta e riaccesa con audit', async () => {
    const { token } = await login(['admin']);
    const auth = { 'X-Operator-Token': token };
    const config = await api().get('/backoffice/config').set(auth).expect(200);
    const ids = (config.body.taxonomies as { id: string }[]).map((taxonomy) => taxonomy.id);
    expect(ids).toEqual(['interests', 'practiceAreas', 'lookingFor', 'profileQuestions']);
    const interests = (config.body.taxonomies as { items: { key: string }[] }[])[0]!.items;
    expect(interests.length).toBeGreaterThan(0);
    const key = interests[0]!.key;
    try {
      const off = await api()
        .put(`/backoffice/config/taxonomies/interests/${key}`)
        .set(auth)
        .send({ active: false, ...why })
        .expect(200);
      expect(off.body).toEqual({ key, active: false });
      expect(
        await count('select count(*) as n from interests where code = $1 and not is_active', [key]),
      ).toBe(1);
      await api()
        .put('/backoffice/config/taxonomies/interests/inesistente')
        .set(auth)
        .send({ active: false, ...why })
        .expect(404);
      await api()
        .put(`/backoffice/config/taxonomies/altro/${key}`)
        .set(auth)
        .send({ active: false, ...why })
        .expect(404);
    } finally {
      await pool.query('update interests set is_active = true where code = $1', [key]);
    }
    expect(
      await count(
        "select count(*) as n from audit_log where action = 'config_changed' and object_id = 'taxonomies.interests'",
      ),
    ).toBe(1);
  });

  it('RC-117 il ruolo backoffice_role non legge le tabelle protette', async () => {
    const client = await pool.connect();
    try {
      await client.query('SET ROLE backoffice_role');
      for (const sql of [
        'select * from messages',
        'select * from excluded_companies',
        'select * from blocks',
        'select * from swipes',
        'select * from open_space_history',
        'select * from offsite_attendees',
        'select interested_in from profiles',
        'select birth_date from profiles',
        'select open_space from users',
        'select email from personal_identities',
      ]) {
        await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
  });
});
