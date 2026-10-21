// Flussi dell'account end to end sul sistema vero (D240): PostgreSQL, MinIO e Mailpit, con i
// codici OTP letti dall'API di Mailpit. Cambio azienda, ri-verifica, sospensione e ripristino,
// cancellazione con ripensamento (anche dalla pagina web), revoca del consenso, "Scarica i miei
// dati", "Email e accesso". Casi RC-20, RC-25, RC-72, RC-73, RC-90, RC-93, RC-127, RC-128,
// RC-139, RC-150, RC-159, RC-193, RC-204.
import type { INestApplication } from '@nestjs/common';
import { unzipSync, strFromU8 } from 'fflate';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AccountLifecycleService } from '../../src/domain/account/account-lifecycle.service';
import { ChatCryptoService } from '../../src/domain/chat-crypto/chat-crypto.service';
import { DataExportsService } from '../../src/domain/account/data-exports.service';
import { WorkIdentityService } from '../../src/domain/work-identity/work-identity.service';
import { CryptoService } from '../../src/infra/crypto/crypto.service';
import { Factory } from '../support/factory';
import { latestCode, latestMessage, messagesTo, uniqueAddress } from '../support/mailpit';
import { bearer, completeProfile, seedCities, signIn } from '../support/profile-support';
import { Rule } from '../support/rule';
import { createTestApp } from '../support/test-app';
import { testConfig } from '../support/test-config';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

// Le email passano davvero da SMTP e Mailpit: tempi più lunghi del solito
jest.setTimeout(30_000);

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
const f = new Factory(pool);
const rule = new Rule(pool);
const crypto = new CryptoService(testConfig());
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

/** Utente attivo con un'email personale unica e l'impronta vera, come dopo la registrazione. */
async function person(company: string, options: Parameters<Factory['user']>[1] = {}) {
  const id = await f.user(company, options);
  const personal = uniqueAddress('persona');
  const hash = crypto.hash('email', personal);
  await pool.query(
    'update personal_identities set email = $2, email_hash = $3, subject = $3 where user_id = $1',
    [id, personal, hash],
  );
  await pool.query(
    "update work_emails set email_hash = $2 where user_id = $1 and status = 'active'",
    [id, crypto.hash('email', await workEmailOf(id))],
  );
  await completeProfile(pool, id);
  const session = await signIn(app, id);
  return { id, personal, ...session };
}

async function workEmailOf(userId: string): Promise<string> {
  const { rows } = await pool.query<{ email: string }>(
    "select email from work_emails where user_id = $1 and status = 'active'",
    [userId],
  );
  return rows[0]!.email;
}

/** Conferma dell'identità con il codice arrivato all'email personale. */
async function confirmIdentity(
  token: string,
  personal: string,
  purpose: 'company_change' | 'access_change',
) {
  await api().post('/identity/confirmation/code').set(bearer(token)).send({ purpose }).expect(202);
  const code = await latestCode(personal);
  await api().post('/identity/confirmation').set(bearer(token)).send({ purpose, code }).expect(204);
}

async function changeCompany(token: string, personal: string, newEmail: string) {
  await confirmIdentity(token, personal, 'company_change');
  await api()
    .post('/identity/company-change/work-email')
    .set(bearer(token))
    .send({ email: newEmail })
    .expect(202);
  const code = await latestCode(newEmail);
  const response = await api()
    .post('/identity/company-change/work-email/verify')
    .set(bearer(token))
    .send({ email: newEmail, code, declarationVersion: 'p7-v1' });
  return response;
}

describe('Cambio azienda (D9, D20, D176)', () => {
  it('RC-72, RC-73, RC-93, RC-150: unica transazione con tutti gli effetti, avviso solo all’email personale', async () => {
    const x = await f.company();
    const y = await f.company();
    const z = await f.company();
    const a = await person(x, { openSpace: true });
    const oldWork = await workEmailOf(a.id);
    const b = await person(y);
    const c = await person(y);
    const exColleague = await person(x);
    const empty = await f.match(a.id, b.id);
    const chat = await f.match(a.id, c.id, { withMessageFrom: c.id });
    await f.like(a.id, (await person(y)).id);
    await f.exclude(a.id, y);
    await pool.query(
      `insert into excluded_company_changes (user_id, company_id, operation, requested_at, effective_at)
       values ($1, $2, 'add', now(), now() + interval '30 hours')`,
      [a.id, z],
    );
    // Senza conferma dell'identità il cambio non parte
    const blocked = await api()
      .post('/identity/company-change/work-email')
      .set(bearer(a.token))
      .send({ email: uniqueAddress('nuovo', await f.domainOf(y)) })
      .expect(403);
    expect(blocked.body.error.code).toBe('identity.confirmation.required');
    const newWork = uniqueAddress('nuovo', await f.domainOf(y));
    const started = new Date();
    const response = await changeCompany(a.token, a.personal, newWork);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      result: 'changed',
      company: { id: y },
      openSpacePrompt: true,
      leftCompanyExcluded: true,
      newCompanyUnexcluded: true,
      scope: 'full',
    });
    // Match senza messaggi revocato, chat avviata che resta, like cancellati (D9, D59)
    expect(await rule.matchStatus(empty)).toEqual({ status: 'closed', close_reason: 'colleagues' });
    expect((await rule.matchStatus(chat)).status).toBe('active');
    expect(
      Number(
        (await pool.query('select count(*) from swipes where from_user_id = $1', [a.id])).rows[0]
          .count,
      ),
    ).toBe(0);
    // Ex colleghi nascosti subito (D176), aggiunta in attesa efficace subito (AF)
    expect(await rule.seeEachOther(a.id, exColleague.id)).toMatchObject({ interact: false });
    const { rows: excluded } = await pool.query<{ company_id: string; source: string }>(
      'select company_id, source from excluded_companies where user_id = $1 order by source',
      [a.id],
    );
    expect(excluded).toEqual(
      expect.arrayContaining([
        { company_id: x, source: 'company_change' },
        { company_id: z, source: 'user' },
      ]),
    );
    expect(excluded.map((row) => row.company_id)).not.toContain(y);
    // Open space spento con origine `company_change`, non contato, e la domanda (D197)
    const openSpace = await api()
      .get('/me/open-space')
      .set(bearer(response.body.accessToken))
      .expect(200);
    expect(openSpace.body).toMatchObject({ enabled: false, prompt: true, changesRemaining: 5 });
    const me = await api().get('/me').set(bearer(response.body.accessToken)).expect(200);
    expect(me.body.excludedCompaniesNotice).toMatchObject({
      leftCompany: { id: x },
      removedCurrentCompany: { id: y },
    });
    // Avviso all'email personale, nulla alla vecchia email aziendale (D9)
    const notice = await latestMessage(a.personal, started);
    expect(notice.subject).toBe('La tua email aziendale è stata aggiornata');
    expect(await messagesTo(oldWork)).toHaveLength(0);
    // L'avviso si conferma una volta
    await api()
      .post('/me/notices/excluded-companies')
      .set(bearer(response.body.accessToken))
      .expect(204);
    const again = await api().get('/me').set(bearer(response.body.accessToken)).expect(200);
    expect(again.body.excludedCompaniesNotice).toBeNull();
  });

  it('RC-20: un secondo vero cambio entro 30 giorni è rifiutato prima del codice', async () => {
    const x = await f.company();
    const y = await f.company();
    const z = await f.company();
    const a = await person(x);
    const first = await changeCompany(
      a.token,
      a.personal,
      uniqueAddress('primo', await f.domainOf(y)),
    );
    expect(first.status).toBe(200);
    await confirmIdentity(first.body.accessToken as string, a.personal, 'company_change').catch(
      async () => {
        // Il codice precedente è di pochi secondi fa: si simula l'attesa minima tra due invii
        await pool.query("update otp_codes set created_at = created_at - interval '1 minute'");
        await confirmIdentity(first.body.accessToken as string, a.personal, 'company_change');
      },
    );
    const second = await api()
      .post('/identity/company-change/work-email')
      .set(bearer(first.body.accessToken as string))
      .send({ email: uniqueAddress('secondo', await f.domainOf(z)) })
      .expect(409);
    expect(second.body.error.code).toBe('companyChange.error.limit');
  });

  it('RC-193: con 15 aziende escluse l’azienda lasciata entra comunque e si toglie subito', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await person(x);
    for (let i = 0; i < 15; i++) await f.exclude(a.id, await f.company());
    const response = await changeCompany(
      a.token,
      a.personal,
      uniqueAddress('nuovo', await f.domainOf(y)),
    );
    expect(response.status).toBe(200);
    const token = response.body.accessToken as string;
    const list = await api().get('/settings/excluded-companies').set(bearer(token)).expect(200);
    expect(list.body.count).toBe(16);
    const companies = list.body.companies as { id: string }[];
    expect(companies.find((row) => row.id === x)).toMatchObject({
      leftCompany: true,
      removableFrom: null,
    });
    const removal = await api()
      .delete(`/settings/excluded-companies/${x}`)
      .set(bearer(token))
      .expect(202);
    expect(removal.body.status).toBe('pending');
  });

  it('rifiuta prima del codice un dominio non in elenco o personale', async () => {
    const x = await f.company();
    const a = await person(x);
    await confirmIdentity(a.token, a.personal, 'company_change');
    const unlisted = await api()
      .post('/identity/company-change/work-email')
      .set(bearer(a.token))
      .send({ email: uniqueAddress('nuovo', 'non-in-elenco.example') })
      .expect(400);
    expect(unlisted.body.error.code).toBe('registration.domain.notListed');
    const personal = await api()
      .post('/identity/company-change/work-email')
      .set(bearer(a.token))
      .send({ email: 'qualcuno@gmail.com' })
      .expect(400);
    expect(personal.body.error.code).toBe('registration.email.personal');
  });
});

describe('Ri-verifica, sospensione e ripristino (D19, D20, D82)', () => {
  it('ri-verifica dovuta, codice dal mittente neutro all’email aziendale e ritorno ad attivo', async () => {
    const x = await f.company();
    const a = await person(x);
    const work = await workEmailOf(a.id);
    await pool.query(
      "update work_emails set next_reverification_at = now() - interval '1 day' where user_id = $1",
      [a.id],
    );
    expect(await app.get(WorkIdentityService).startDueReverifications()).toBe(1);
    expect((await latestMessage(a.personal)).subject).toBe('Conferma la tua email aziendale');
    const { token } = await signIn(app, a.id);
    await api().post('/identity/reverification/code').set(bearer(token)).expect(202);
    const message = await latestMessage(work);
    expect(message.from).toBe(testConfig().emailFromNeutral);
    expect(message.text).not.toContain('Swipe');
    const code = await latestCode(work);
    await api()
      .post('/identity/reverification/verify')
      .set(bearer(token))
      .send({ code })
      .expect(200);
    const { rows } = await pool.query('select status from users where id = $1', [a.id]);
    expect(rows[0].status).toBe('active');
  });

  it('RC-25, RC-127: ri-verifica scaduta, sospensione e ripristino con la stessa email', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await person(x);
    const b = await person(y);
    const match = await f.match(a.id, b.id, { withMessageFrom: b.id });
    await pool.query(
      "update users set status = 'reverifying', reverification_reason = 'expiry', reverification_due_at = now() - interval '1 hour' where id = $1",
      [a.id],
    );
    expect(await app.get(WorkIdentityService).suspendExpired()).toBe(1);
    expect(await rule.canSee(b.id, a.id)).toBe(false);
    expect(await rule.canWrite(b.id, match)).toBe(false);
    expect((await latestMessage(a.personal)).subject).toBe('Il tuo account è in sospeso');
    const { token } = await signIn(app, a.id);
    const me = await api().get('/me').set(bearer(token)).expect(200);
    expect(me.body).toMatchObject({ status: 'suspended', scope: 'restore' });
    await api().post('/identity/reverification/code').set(bearer(token)).expect(202);
    const code = await latestCode(await workEmailOf(a.id));
    const restored = await api()
      .post('/identity/reverification/verify')
      .set(bearer(token))
      .send({ code })
      .expect(200);
    expect(restored.body.scope).toBe('full');
    expect(await rule.canWrite(b.id, match)).toBe(true);
    expect(
      Number(
        (await pool.query('select count(*) from company_changes where user_id = $1', [a.id]))
          .rows[0].count,
      ),
    ).toBe(0);
  });

  it('RC-127: il ripristino con un’altra azienda non conta per il limite dei 30 giorni', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await person(x, { status: 'suspended' });
    const { token } = await signIn(app, a.id);
    const email = uniqueAddress('nuovo', await f.domainOf(y));
    await api().post('/identity/restore/work-email').set(bearer(token)).send({ email }).expect(202);
    const code = await latestCode(email);
    const response = await api()
      .post('/identity/restore/work-email/verify')
      .set(bearer(token))
      .send({ email, code, declarationVersion: 'p7-v1' })
      .expect(200);
    expect(response.body).toMatchObject({ result: 'changed', scope: 'full' });
    const { rows } = await pool.query('select source from company_changes where user_id = $1', [
      a.id,
    ]);
    expect(rows).toEqual([{ source: 'restore' }]);
  });
});

describe('Cancellazione e consenso (D33, D83, D98)', () => {
  it('RC-139: ripensamento nascosto e annullabile, poi cancellazione definitiva con le eccezioni', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await person(x);
    const b = await person(y);
    const match = await f.match(a.id, b.id, { withMessageFrom: b.id });
    await f.message(match, a.id);
    const other = await signIn(app, a.id);
    await api().post('/me/deletion/code').set(bearer(a.token)).expect(202);
    const code = await latestCode(a.personal);
    const requested = await api()
      .post('/me/deletion')
      .set(bearer(a.token))
      .send({ code })
      .expect(200);
    expect(requested.body).toMatchObject({ scope: 'limited', consentRevoked: false });
    await api().get('/me').set(bearer(other.token)).expect(401);
    expect(await rule.canSee(b.id, a.id)).toBe(false);
    expect((await latestMessage(a.personal)).subject).toContain('Cancellazione');
    const limited = requested.body.accessToken as string;
    const cancelled = await api().delete('/me/deletion').set(bearer(limited)).expect(200);
    expect(cancelled.body.scope).toBe('full');
    expect(await rule.canSee(b.id, a.id)).toBe(true);
    // Di nuovo, poi i 7 giorni passano
    await pool.query("update otp_codes set created_at = created_at - interval '1 minute'");
    await api()
      .post('/me/deletion/code')
      .set(bearer(cancelled.body.accessToken as string))
      .expect(202);
    const second = await latestCode(a.personal);
    await api()
      .post('/me/deletion')
      .set(bearer(cancelled.body.accessToken as string))
      .send({ code: second })
      .expect(200);
    await pool.query(
      "update users set deletion_final_at = now() - interval '1 minute' where id = $1",
      [a.id],
    );
    expect(await app.get(AccountLifecycleService).completeDueDeletions()).toBe(1);
    expect((await pool.query('select 1 from users where id = $1', [a.id])).rowCount).toBe(0);
    expect((await rule.matchStatus(match)).close_reason).toBe('account_deleted');
    const messages = await pool.query<{ sender_id: string }>(
      'select sender_id from messages where match_id = $1',
      [match],
    );
    expect(messages.rows.map((row) => row.sender_id)).toEqual([b.id]);
    const consents = await pool.query<{ email_hash: string | null }>(
      'select email_hash from consents where user_id = $1',
      [a.id],
    );
    expect(consents.rows.length).toBe(3);
    expect(consents.rows.every((row) => row.email_hash === crypto.hash('email', a.personal))).toBe(
      true,
    );
    expect((await latestMessage(a.personal)).subject).toBe('Il tuo account è stato cancellato');
  });

  it('revoca del consenso art. 9 con una conferma; annullandola il consenso torna', async () => {
    const x = await f.company();
    const a = await person(x);
    const revoked = await api()
      .post('/me/consents/art9/revocation')
      .set(bearer(a.token))
      .expect(200);
    expect(revoked.body).toMatchObject({ consentRevoked: true, scope: 'limited' });
    const me = await api()
      .get('/me')
      .set(bearer(revoked.body.accessToken as string))
      .expect(200);
    expect(me.body).toMatchObject({ consentRevoked: true });
    const back = await api()
      .delete('/me/deletion')
      .set(bearer(revoked.body.accessToken as string))
      .expect(200);
    const consents = await api()
      .get('/me/consents')
      .set(bearer(back.body.accessToken as string))
      .expect(200);
    const art9 = (consents.body as { type: string; revokedAt: string | null }[]).filter(
      (row) => row.type === 'art9',
    );
    expect(art9).toHaveLength(2);
    expect(art9.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it('RC-90: la pagina web risponde uguale e non scrive mai a un’email aziendale storica', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await person(x);
    const historical = uniqueAddress('vecchia', await f.domainOf(x));
    await pool.query(
      `insert into work_emails (user_id, company_id, domain, email_hash, status, verified_at, next_reverification_at)
       values ($1, $2, $3, $4, 'historical', now(), now())`,
      [a.id, x, await f.domainOf(x), crypto.hash('email', historical)],
    );
    const unknown = uniqueAddress('sconosciuto');
    const responses = [];
    for (const email of [unknown, historical]) {
      responses.push((await api().post('/web-deletion/code').send({ email }).expect(202)).body);
    }
    expect(responses[0]).toEqual(responses[1]);
    expect(await messagesTo(historical)).toHaveLength(0);
    expect(await messagesTo(unknown)).toHaveLength(0);
    // Con l'email aziendale attiva il codice va all'email personale (D83)
    const suspended = await person(y, { status: 'suspended' });
    await api()
      .post('/web-deletion/code')
      .send({ email: await workEmailOf(suspended.id) })
      .expect(202);
    expect(await messagesTo(suspended.personal)).toHaveLength(0);
    await api()
      .post('/web-deletion/code')
      .send({ email: await workEmailOf(a.id) })
      .expect(202);
    const code = await latestCode(a.personal);
    const confirmed = await api()
      .post('/web-deletion/confirm')
      .send({ email: await workEmailOf(a.id), code })
      .expect(200);
    expect(confirmed.body.status).toBe('requested');
    await api().get('/me').set(bearer(a.token)).expect(401);
  });
});

describe('"Scarica i miei dati" (D83)', () => {
  it('RC-128, RC-159: solo i dati propri, con lo storico dell’Open space e le foto', async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await person(x, { openSpace: true });
    const b = await person(y);
    await pool.query("update profiles set first_name = 'Bruno' where user_id = $1", [b.id]);
    const matchId = await f.match(a.id, b.id, { withMessageFrom: b.id });
    // Messaggio di A cifrato davvero con la chiave del match (D183): nell'esportazione in chiaro
    const sealed = await app.get(ChatCryptoService).seal(matchId, 'Un pptx insieme?');
    await pool.query(
      `insert into messages (match_id, sender_id, ciphertext, nonce, client_message_id)
       values ($1, $2, $3, $4, gen_random_uuid())`,
      [matchId, a.id, sealed.ciphertext, sealed.nonce],
    );
    const requested = await api().post('/me/exports').set(bearer(a.token)).expect(202);
    expect(requested.body.status).toBe('pending');
    const again = await api().post('/me/exports').set(bearer(a.token)).expect(202);
    expect(again.body.id).toBe(requested.body.id);
    expect(await app.get(DataExportsService).prepareDue()).toBe(1);
    const ready = await api()
      .get(`/me/exports/${requested.body.id}`)
      .set(bearer(a.token))
      .expect(200);
    expect(ready.body.status).toBe('ready');
    expect((await latestMessage(a.personal)).subject).toBe('I tuoi dati sono pronti');
    const zip = Buffer.from(await (await fetch(ready.body.downloadUrl as string)).arrayBuffer());
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['account.json', 'open_space_storico.json', 'foto/foto-1.jpg']),
    );
    const everything = Object.entries(files)
      .filter(([name]) => name.endsWith('.json'))
      .map(([, content]) => strFromU8(content))
      .join('\n');
    expect(everything).not.toContain('Bruno');
    expect(everything).not.toContain(b.id);
    expect(everything).not.toContain(b.personal);
    const written = JSON.parse(strFromU8(files['messaggi_scritti.json']!)) as { testo: string }[];
    expect(written.map((message) => message.testo)).toEqual(['Un pptx insieme?']);
    const history = JSON.parse(strFromU8(files['open_space_storico.json']!)) as unknown[];
    expect(history).toHaveLength(1);
    await pool.query(
      "update data_exports set status = 'ready', requested_at = requested_at - interval '1 day'",
    );
    const limited = await api().post('/me/exports').set(bearer(a.token)).expect(429);
    expect(limited.body.error.code).toBe('dataExport.limit');
  });
});

describe('Email e accesso (D82, D224, D233)', () => {
  it('spegne l’accesso con l’email aziendale: il codice di accesso non parte più', async () => {
    const x = await f.company();
    const a = await person(x);
    const work = await workEmailOf(a.id);
    const info = await api().get('/me/access').set(bearer(a.token)).expect(200);
    expect(info.body).toMatchObject({
      provider: 'email',
      personalEmail: a.personal,
      workEmailSignIn: true,
    });
    await api().put('/me/access').set(bearer(a.token)).send({ workEmailSignIn: false }).expect(200);
    await api().post('/auth/code').send({ email: work }).expect(202);
    expect(await messagesTo(work)).toHaveLength(0);
  });

  it('RC-204: cambio del modo di accesso verso un’altra email, con la conferma di quello di oggi', async () => {
    const x = await f.company();
    const a = await person(x, { openSpace: true });
    await confirmIdentity(a.token, a.personal, 'access_change');
    const next = uniqueAddress('nuova');
    await api()
      .post('/me/access/method/email-code')
      .set(bearer(a.token))
      .send({ email: next })
      .expect(202);
    const code = await latestCode(next);
    const changed = await api()
      .put('/me/access/method')
      .set(bearer(a.token))
      .send({ provider: 'email', email: next, code })
      .expect(200);
    expect(changed.body).toMatchObject({ provider: 'email', personalEmail: next });
    const { rows } = await pool.query(
      'select count(*)::int as n from personal_identities where user_id = $1',
      [a.id],
    );
    expect(rows[0].n).toBe(1);
    const user = await pool.query('select company_id, open_space from users where id = $1', [a.id]);
    expect(user.rows[0]).toEqual({ company_id: x, open_space: true });
    expect((await latestMessage(a.personal)).subject).toBe('Il modo di accesso è stato cambiato');
  });

  it('cambio dell’email personale con i codici sulla vecchia e sulla nuova (D82)', async () => {
    const x = await f.company();
    const a = await person(x);
    const next = uniqueAddress('cambiata');
    await api().post('/me/personal-email').set(bearer(a.token)).send({ email: next }).expect(202);
    const oldCode = await latestCode(a.personal);
    const newCode = await latestCode(next);
    const response = await api()
      .post('/me/personal-email/verify')
      .set(bearer(a.token))
      .send({ email: next, oldCode, newCode })
      .expect(200);
    expect(response.body.personalEmail).toBe(next);
    const work = await api()
      .post('/me/personal-email')
      .set(bearer(a.token))
      .send({ email: uniqueAddress('lavoro', await f.domainOf(x)) })
      .expect(400);
    expect(work.body.error.code).toBe('settings.access.personalEmail.workEmail');
  });
});
