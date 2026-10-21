// Integrazione di sicurezza, moderazione e amministrazione (team B3) con PostgreSQL, MinIO e i
// ruoli veri del database (`app_role`, `backoffice_role`): segnalazioni, sanzioni, ricorsi,
// verifica dell'età, lettura motivata delle chat, utenti, rimozione delle aziende e finestre di
// revisione degli store.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { SessionsService } from '../../src/app/auth/sessions.service';
import { ChatCryptoService } from '../../src/domain/chat-crypto/chat-crypto.service';
import { CryptoService } from '../../src/infra/crypto/crypto.service';
import { Factory } from '../support/factory';
import { testConfig } from '../support/test-config';
import type { CaptureEmailSender } from '../support/capture-email-sender';
import { loginOperator, type TestOperator } from '../support/operator';
import { Rule } from '../support/rule';
import { createTestApp } from '../support/test-app';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
const f = new Factory(pool);
const rule = new Rule(pool);
let app: INestApplication<App>;
let admin: INestApplication<App>;
let adminEmail: CaptureEmailSender;

beforeAll(async () => {
  ({ app } = await createTestApp('app'));
  ({ app: admin, email: adminEmail } = await createTestApp('admin'));
});

beforeEach(async () => {
  await truncateAll(pool);
  adminEmail.sent.length = 0;
});

afterAll(async () => {
  await app.close();
  await admin.close();
  await pool.end();
});

const appApi = () => request(app.getHttpServer());
const adminApi = () => request(admin.getHttpServer());
const why = { explanation: 'Verifica del caso in coda' };
const count = async (sql: string, params: unknown[] = []) =>
  Number((await pool.query<{ n: string }>(sql, params)).rows[0]!.n);

/** Token di accesso dell'utente, da una sessione vera. */
async function tokenOf(userId: string): Promise<{ Authorization: string }> {
  const session = await app.get(SessionsService).create(userId, 'personal_email');
  return { Authorization: `Bearer ${session.accessToken}` };
}

async function operator(roles?: string[]): Promise<TestOperator> {
  return loginOperator(admin, pool, adminEmail, roles);
}

async function setBio(userId: string, bio: string): Promise<void> {
  await pool.query('update profiles set bio = $2 where user_id = $1', [userId, bio]);
}

describe('Segnalazioni dall’app (D71, D72, D113)', () => {
  it('RC-112 blocco automatico, match chiuso, copie del profilo; nessun segno per la persona segnalata', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    await setBio(b, 'Bio da esaminare');
    const m = await f.match(a, b);
    const response = await appApi()
      .post('/reports')
      .set(await tokenOf(a))
      .send({ userId: b, reason: 'fake_profile', source: 'match', matchId: m })
      .expect(202);
    expect(response.body).toEqual({ status: 'received' });
    expect(await rule.matchStatus(m)).toEqual({ status: 'closed', close_reason: 'blocked' });
    expect(await rule.seeEachOther(a, b)).toMatchObject({ interact: false });
    const report = (
      await pool.query(
        "select from_match, severity, due_at > now() + interval '71 hours' as late from reports",
      )
    ).rows[0];
    expect(report).toEqual({ from_match: true, severity: 'standard', late: true });
    expect(
      await count("select count(*) as n from report_contents where type = 'profile_text'"),
    ).toBeGreaterThan(0);
    // Il testo copiato è cifrato con la chiave della segnalazione
    const stored = await pool.query<{ ciphertext: Buffer }>(
      "select ciphertext from report_contents where field = 'bio'",
    );
    expect(stored.rows[0]!.ciphertext.toString('utf8')).not.toContain('Bio da esaminare');
    expect(await count('select count(*) as n from user_notices where user_id = $1', [b])).toBe(0);
    // Una persona che non si vede e senza match non si segnala: 404 neutro
    const stranger = await f.user(await f.company());
    const colleague = await f.user(
      (
        await pool.query<{ company_id: string }>('select company_id from users where id = $1', [
          stranger,
        ])
      ).rows[0]!.company_id,
    );
    await appApi()
      .post('/reports')
      .set(await tokenOf(stranger))
      .send({ userId: colleague, reason: 'spam_scam', source: 'feed' })
      .expect(404);
  });

  it('RC-140 "possibile minorenne": sospensione subito da un match o alla seconda di un’altra persona', async () => {
    const target = await f.user(await f.company());
    const first = await f.user(await f.company());
    const second = await f.user(await f.company());
    await appApi()
      .post('/reports')
      .set(await tokenOf(first))
      .send({ userId: target, reason: 'possible_minor', source: 'feed' })
      .expect(202);
    expect(await count('select count(*) as n from sanctions where user_id = $1', [target])).toBe(0);
    expect((await pool.query('select severity from reports')).rows[0]).toEqual({
      severity: 'severe',
    });
    await appApi()
      .post('/reports')
      .set(await tokenOf(second))
      .send({ userId: target, reason: 'possible_minor', source: 'feed' })
      .expect(202);
    expect(
      await count(
        "select count(*) as n from sanctions where user_id = $1 and type = 'precautionary_suspension'",
        [target],
      ),
    ).toBe(1);
    const visible = await pool.query<{ v: boolean }>('select account_visible($1) as v', [target]);
    expect(visible.rows[0]!.v).toBe(false);
    expect(
      await count('select count(*) as n from age_verifications where user_id = $1', [target]),
    ).toBe(1);
    // Da un match la sospensione è immediata anche alla prima segnalazione
    const other = await f.user(await f.company());
    const matched = await f.user(await f.company());
    await f.match(other, matched);
    await appApi()
      .post('/reports')
      .set(await tokenOf(matched))
      .send({ userId: other, reason: 'possible_minor', source: 'match' })
      .expect(202);
    expect(await count('select count(*) as n from sanctions where user_id = $1', [other])).toBe(1);
  });

  it('RC-122 e RC-157 "Lavora nella mia azienda": ri-verifica neutra una volta ogni 30 giorni, mai con l’Open space reciproco', async () => {
    const x = await f.company();
    const y = await f.company();
    const c = await f.user(x, { openSpace: true });
    const d = await f.user(x, { openSpace: true });
    await appApi()
      .post('/reports')
      .set(await tokenOf(c))
      .send({ userId: d, reason: 'works_at_my_company', source: 'feed' })
      .expect(400);
    const a = await f.user(x);
    const b = await f.user(y);
    await appApi()
      .post('/reports')
      .set(await tokenOf(a))
      .send({ userId: b, reason: 'works_at_my_company', source: 'feed' })
      .expect(202);
    const target = (
      await pool.query('select status, reverification_reason from users where id = $1', [b])
    ).rows[0];
    expect(target).toEqual({ status: 'reverifying', reverification_reason: 'ad_hoc' });
    expect(
      (await pool.query('select reporter_company_id, reported_company_id from reports')).rows[0],
    ).toEqual({
      reporter_company_id: x,
      reported_company_id: y,
    });
    // Non entra nella coda di moderazione
    const op = await operator(['moderator']);
    const queue = await adminApi().get('/backoffice/moderation/queue').set(op.auth).expect(200);
    expect(queue.body).toEqual([]);
  });

  it('copia dei messaggi allegati: leggibili dal Moderatore anche dopo la cancellazione del match', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const m = await f.match(a, b);
    const chats = app.get(ChatCryptoService);
    const ids: string[] = [];
    for (const [sender, text] of [
      [b, 'messaggio offensivo'],
      [a, 'smettila'],
    ] as const) {
      const sealed = await chats.seal(m, text);
      const { rows } = await pool.query<{ id: string }>(
        `insert into messages (match_id, sender_id, ciphertext, nonce, client_message_id)
         values ($1, $2, $3, $4, gen_random_uuid()) returning id`,
        [m, sender, sealed.ciphertext, sealed.nonce],
      );
      ids.push(rows[0]!.id);
    }
    await appApi()
      .post('/reports')
      .set(await tokenOf(a))
      .send({
        userId: b,
        reason: 'harassment',
        source: 'chat',
        matchId: m,
        messageIds: ids,
        containsThreats: true,
      })
      .expect(202);
    await pool.query('delete from matches where id = $1', [m]);
    const op = await operator(['moderator']);
    const queue = await adminApi().get('/backoffice/moderation/queue').set(op.auth).expect(200);
    expect(queue.body[0]).toMatchObject({
      kind: 'report',
      reason: 'harassment',
      severity: 'severe',
    });
    const detail = await adminApi()
      .get(`/backoffice/moderation/cases/${queue.body[0].id as string}`)
      .set(op.auth)
      .expect(200);
    expect(
      (detail.body.flaggedMessages as { text: string; fromReported: boolean }[]).map((item) => [
        item.fromReported,
        item.text,
      ]),
    ).toEqual([
      [true, 'messaggio offensivo'],
      [false, 'smettila'],
    ]);
    // Chi segnala resta anonimo: nessun identificativo nella risposta
    expect(JSON.stringify(detail.body)).not.toContain(a);
  });
});

describe('Decisioni, sanzioni e ricorsi (D75, D88, D113)', () => {
  it('sospensione dal caso: sessioni limited, esito generico a chi segnala, ricorso deciso da un’altra persona', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const reporter = await tokenOf(a);
    const reported = await tokenOf(b);
    await appApi()
      .post('/reports')
      .set(reporter)
      .send({ userId: b, reason: 'spam_scam', source: 'feed' })
      .expect(202);
    const moderator = await operator(['moderator']);
    const caseId = (await adminApi().get('/backoffice/moderation/queue').set(moderator.auth))
      .body[0].id as string;
    await adminApi()
      .post(`/backoffice/moderation/cases/${caseId}`)
      .set(moderator.auth)
      .send({ ...why, decision: 'disciplinary_suspension' })
      .expect(400);
    await adminApi()
      .post(`/backoffice/moderation/cases/${caseId}`)
      .set(moderator.auth)
      .send({
        ...why,
        decision: 'disciplinary_suspension',
        userExplanation: 'Messaggi promozionali ripetuti',
      })
      .expect(204);
    // La sessione dell'utente sospeso passa a limited: il vecchio token non vale più
    await appApi().get('/me/sanctions').set(reported).expect(401);
    const limited = await tokenOf(b);
    const mine = await appApi().get('/me/sanctions').set(limited).expect(200);
    expect(mine.body[0]).toMatchObject({
      type: 'disciplinary_suspension',
      active: true,
      explanation: 'Messaggi promozionali ripetuti',
    });
    const outcomes = await appApi().get('/me/reports').set(reporter).expect(200);
    expect(outcomes.body[0].reviewedAt).not.toBeNull();
    expect(
      await count(
        "select count(*) as n from user_notices where user_id = $1 and template = 'sanction.decided'",
        [b],
      ),
    ).toBe(1);
    await appApi()
      .post(`/me/sanctions/${mine.body[0].id as string}/appeal`)
      .set(limited)
      .send({ text: 'Non era spam' })
      .expect(202);
    await appApi()
      .post(`/me/sanctions/${mine.body[0].id as string}/appeal`)
      .set(limited)
      .send({ text: 'Di nuovo' })
      .expect(409);
    const appeals = await adminApi().get('/backoffice/appeals').set(moderator.auth).expect(200);
    expect(appeals.body[0]).toMatchObject({
      subject: 'disciplinary_suspension',
      decidedByMe: true,
    });
    const support = await operator(['support']);
    await adminApi()
      .post(`/backoffice/appeals/${appeals.body[0].id as string}/decision`)
      .set(moderator.auth)
      .send({ ...why, outcome: 'upheld' })
      .expect(403);
    await adminApi()
      .post(`/backoffice/appeals/${appeals.body[0].id as string}/decision`)
      .set(support.auth)
      .send({ ...why, outcome: 'upheld', userExplanation: 'Ricorso accolto' })
      .expect(204);
    expect(
      (await pool.query<{ v: boolean }>('select account_visible($1) as v', [b])).rows[0]!.v,
    ).toBe(true);
  });

  it('espulsione: impronte delle due email bloccate e revocate se il ricorso è accolto (D75)', async () => {
    const b = await f.user(await f.company());
    const admin = await operator();
    await adminApi()
      .post(`/backoffice/users/${b}/sanctions`)
      .set(admin.auth)
      .send({
        ...why,
        type: 'expulsion',
        severeCase: 'fraud',
        userExplanation: 'Truffa ai danni di altri utenti',
      })
      .expect(201);
    expect(await count("select count(*) as n from blocked_hashes where source = 'expulsion'")).toBe(
      2,
    );
    const code = (
      await pool.query<{ params: { appealCode: string } }>(
        "select params from user_notices where template = 'sanction.decided'",
      )
    ).rows[0]!.params.appealCode;
    await appApi().post('/appeals').send({ code, text: 'Ricorso con il collegamento' }).expect(202);
    const appeal = (await adminApi().get('/backoffice/appeals').set(admin.auth)).body[0];
    // Decide una persona diversa da chi ha espulso (D88)
    const reviewer = await operator(['support']);
    await adminApi()
      .post(`/backoffice/appeals/${appeal.id as string}/decision`)
      .set(reviewer.auth)
      .send({ ...why, outcome: 'accepted' })
      .expect(204);
    expect(await count('select count(*) as n from blocked_hashes')).toBe(0);
  });
});

describe('Limiti del backoffice (D90, D181, D187)', () => {
  it('RC-117 il ruolo del backoffice non legge messaggi, blocchi, esclusioni, "chi ti interessa" né l’Open space', async () => {
    const client = await pool.connect();
    try {
      for (const query of [
        'select * from messages',
        'select * from blocks',
        'select * from excluded_companies',
        'select * from swipes',
        'select * from open_space_history',
        'select interested_in from profiles',
        'select open_space from users',
        'select birth_date from profiles',
      ]) {
        await client.query('begin');
        await client.query('set local role backoffice_role');
        await expect(client.query(query)).rejects.toMatchObject({ code: '42501' });
        await client.query('rollback');
      }
    } finally {
      client.release();
    }
  });

  it('RC-199 lettura della chat: solo l’Amministratore, con motivo, periodo e identificativo digitato; audit senza testi', async () => {
    const a = await f.user(await f.company());
    const b = await f.user(await f.company());
    const m = await f.match(a, b);
    const sealed = await app.get(ChatCryptoService).seal(m, 'testo riservato');
    await pool.query(
      `insert into messages (match_id, sender_id, ciphertext, nonce, client_message_id)
       values ($1, $2, $3, $4, gen_random_uuid())`,
      [m, a, sealed.ciphertext, sealed.nonce],
    );
    const body = {
      ...why,
      reason: 'authority_request',
      reference: 'Richiesta 2026/123',
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
      confirmName: m,
    };
    const moderator = await operator(['moderator']);
    await adminApi()
      .post(`/backoffice/matches/${m}/chat-read`)
      .set(moderator.auth)
      .send(body)
      .expect(403);
    const admin = await operator(['admin']);
    // Senza l'identificativo del match digitato, o con uno diverso, la lettura è respinta (D244)
    const { confirmName: _typed, ...withoutName } = body;
    await adminApi()
      .post(`/backoffice/matches/${m}/chat-read`)
      .set(admin.auth)
      .send(withoutName)
      .expect(400);
    const mismatch = await adminApi()
      .post(`/backoffice/matches/${m}/chat-read`)
      .set(admin.auth)
      .send({ ...body, confirmName: randomUUID() })
      .expect(400);
    expect(mismatch.body.error.code).toBe('confirmation.mismatch');
    const read = await adminApi()
      .post(`/backoffice/matches/${m}/chat-read`)
      .set(admin.auth)
      .send(body)
      .expect(200);
    expect((read.body as { text: string }[]).map((item) => item.text)).toEqual(['testo riservato']);
    const audit = await pool.query<{ details: unknown; explanation: string }>(
      "select details, explanation from audit_log where action = 'chat_read'",
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain('testo riservato');
  });

  it('scheda con le email mascherate; rivelazione registrata; data di nascita solo con 18 anni (RC-142)', async () => {
    const b = await f.user(await f.company());
    const support = await operator(['support']);
    const card = await adminApi().get(`/backoffice/users/${b}`).set(support.auth).expect(200);
    expect(card.body.maskedPersonalEmail).toMatch(/^p\*\*\*@p\*\*\*\.example$/);
    expect(JSON.stringify(card.body)).not.toMatch(/interested|openSpace|birth/i);
    const revealed = await adminApi()
      .post(`/backoffice/users/${b}/reveal-email`)
      .set(support.auth)
      .send({ ...why, kind: 'personal' })
      .expect(200);
    expect(revealed.body).toEqual({ kind: 'personal', email: `persona-${b}@personale.example` });
    expect(await count("select count(*) as n from audit_log where action = 'email_revealed'")).toBe(
      1,
    );
    await adminApi()
      .post(`/backoffice/users/${b}/reveal-email`)
      .set(support.auth)
      .send({ explanation: 'scrive a persona@esempio.it', kind: 'personal' })
      .expect(400);
    await adminApi()
      .post(`/backoffice/users/${b}/birth-date`)
      .set(support.auth)
      .send({ ...why, birthDate: '2015-01-01' })
      .expect(400);
    const age = await adminApi()
      .post(`/backoffice/users/${b}/birth-date`)
      .set(support.auth)
      .send({ ...why, birthDate: '1990-06-15' })
      .expect(200);
    expect(age.body.ageYears).toBeGreaterThanOrEqual(36);
    // Il Moderatore vede solo le schede dei casi in coda
    const moderator = await operator(['moderator']);
    await adminApi().get(`/backoffice/users/${b}`).set(moderator.auth).expect(404);
  });

  it('RC-141 verifica dell’età: caricamento su MinIO, documento al Supporto, file cancellato con l’esito', async () => {
    const b = await f.user(await f.company());
    const support = await operator(['support']);
    await adminApi()
      .post(`/backoffice/users/${b}/age-verification`)
      .set(support.auth)
      .send(why)
      .expect(204);
    const token = await tokenOf(b);
    const upload = await appApi().post('/me/age-verification/upload').set(token).expect(200);
    const put = await fetch(upload.body.uploadUrl as string, {
      method: 'PUT',
      body: Buffer.from('documento'),
    });
    expect(put.ok).toBe(true);
    await appApi()
      .post('/me/age-verification/upload/confirmation')
      .set(token)
      .send({ key: upload.body.key })
      .expect(204);
    const doc = await adminApi()
      .get(`/backoffice/users/${b}/age-verification`)
      .set(support.auth)
      .expect(200);
    expect(await (await fetch(doc.body.documentUrl as string)).text()).toBe('documento');
    const moderator = await operator(['moderator']);
    await adminApi().get(`/backoffice/users/${b}/age-verification`).set(moderator.auth).expect(403);
    await adminApi()
      .post(`/backoffice/users/${b}/age-verification/outcome`)
      .set(support.auth)
      .send({ ...why, outcome: 'adult' })
      .expect(204);
    expect((await fetch(doc.body.documentUrl as string)).ok).toBe(false);
    expect(await count('select count(*) as n from age_verifications')).toBe(0);
    expect(
      (await pool.query("select details from audit_log where action = 'age_verification_recorded'"))
        .rows[0],
    ).toEqual({ details: { outcome: 'adult' } });
    expect(
      (await pool.query<{ v: boolean }>('select account_visible($1) as v', [b])).rows[0]!.v,
    ).toBe(true);
  });
});

describe('Elenco e store (D42, D93, D111)', () => {
  it('rimozione di un’azienda con anteprima e conferma rafforzata; annullamento', async () => {
    const x = await f.company();
    await f.user(x);
    const name = (
      await pool.query<{ name: string }>('select name from companies where id = $1', [x])
    ).rows[0]!.name;
    const admin = await operator(['admin']);
    const preview = await adminApi()
      .get(`/backoffice/companies/${x}/removal/preview`)
      .set(admin.auth)
      .expect(200);
    expect(preview.body).toMatchObject({ name, accountsCount: 1 });
    await adminApi()
      .post(`/backoffice/companies/${x}/removal`)
      .set(admin.auth)
      .send({ ...why, confirmName: 'Altro' })
      .expect(400);
    // Il secondo fattore non c'è più (D244): un campo `totp` non è ammesso
    await adminApi()
      .post(`/backoffice/companies/${x}/removal`)
      .set(admin.auth)
      .send({ ...why, confirmName: name, totp: '123456' })
      .expect(400);
    const started = await adminApi()
      .post(`/backoffice/companies/${x}/removal`)
      .set(admin.auth)
      .send({ ...why, confirmName: name })
      .expect(200);
    expect(started.body).toMatchObject({ status: 'removing', removalFinalAt: expect.any(String) });
    const cancelled = await adminApi()
      .delete(`/backoffice/companies/${x}/removal`)
      .set(admin.auth)
      .send(why)
      .expect(200);
    expect(cancelled.body.status).toBe('active');
  });

  it('RC-87 codice di revisione: solo per gli account dimostrativi con una finestra aperta; 10 errori la chiudono', async () => {
    const demo = await f.user(await f.company({ isDemo: true }), { isDemo: true });
    const real = await f.user(await f.company());
    const admin = await operator(['admin']);
    const opened = await adminApi()
      .post('/backoffice/store-review/windows')
      .set(admin.auth)
      .send({ ...why, store: 'apple', days: 7 })
      .expect(201);
    const code = opened.body.code as string;
    const demoEmail = `persona-${demo}@personale.example`;
    // Impronta vera dell'email, come per un'identità creata dalla registrazione
    const hashes = new CryptoService(testConfig('app'));
    await pool.query(
      'update personal_identities set email_hash = $2, subject = $2 where user_id = $1',
      [demo, hashes.hash('email', demoEmail)],
    );
    const signedIn = await appApi()
      .post('/auth/verify')
      .send({ email: demoEmail, code })
      .expect(200);
    expect(signedIn.body.result).toBe('signedIn');
    await appApi()
      .post('/auth/verify')
      .send({ email: `persona-${real}@personale.example`, code })
      .expect(400);
    for (let i = 0; i < 10; i++) {
      await appApi()
        .post('/auth/verify')
        .send({ email: demoEmail, code: code === '000000' ? '111111' : '000000' })
        .expect(400);
    }
    await appApi().post('/auth/verify').send({ email: demoEmail, code }).expect(400);
    const overview = await adminApi().get('/backoffice/store-review').set(admin.auth).expect(200);
    expect(overview.body.windows[0]).toMatchObject({
      store: 'apple',
      failedAttempts: 10,
      closedAt: expect.any(String),
    });
    expect(overview.body.accounts[0].maskedEmail).toMatch(/\*\*\*/);
  });
});
