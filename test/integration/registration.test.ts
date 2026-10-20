// Integrazione dell'API dell'app con PostgreSQL reale e il ruolo `app_role`: accesso,
// registrazione nell'ordine di D224 e D236, sessioni e identità di Apple e Google.
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { normalizeEmail } from '../../src/domain/email/email-address';
import { CryptoService } from '../../src/infra/crypto/crypto.service';
import type { LogEmailSender } from '../../src/infra/email/log-email-sender';
import { Factory } from '../support/factory';
import { createTestApp, FakeProviders } from '../support/test-app';
import { testConfig } from '../support/test-config';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
const f = new Factory(pool);
const crypto = new CryptoService(testConfig());
let app: INestApplication<App>;
let email: LogEmailSender;
let providers: FakeProviders;
let company: string;
let domain: string;

beforeAll(async () => {
  providers = await FakeProviders.create();
  ({ app, email } = await createTestApp('app', providers));
});

beforeEach(async () => {
  await truncateAll(pool);
  email.sent.length = 0;
  await f.city();
  company = await f.company({ domain: 'modellopartners.example' });
  domain = 'modellopartners.example';
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const api = () => request(app.getHttpServer());
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const count = async (sql: string, params: unknown[] = []) =>
  Number((await pool.query<{ n: string }>(sql, params)).rows[0]!.n);

/** Simula l'attesa minima tra due codici allo stesso indirizzo (30 secondi). */
const waitBetweenCodes = () =>
  pool.query("update otp_codes set created_at = created_at - interval '1 minute'");

/** Passo 1 con l'email personale: codice e verifica. */
async function startWithEmail(address: string) {
  await api().post('/registration/personal-email').send({ email: address }).expect(202);
  const code = email.lastCodeFor(address)!;
  const response = await api()
    .post('/registration/personal-email/verify')
    .send({ email: address, code })
    .expect(200);
  return response.body as {
    result: string;
    session: { accessToken: string; refreshToken: string; scope: string };
  };
}

/** Passi 2–7 per un account appena creato. */
async function completeSteps(token: string, workEmail = `luca.conti@${domain}`) {
  const normalized = normalizeEmail(workEmail)!.email;
  await api()
    .put('/registration/birth-date')
    .set(auth(token))
    .send({ birthDate: '1993-04-12', termsAccepted: true, termsVersion: 't1' })
    .expect(200);
  await api()
    .post('/registration/work-email')
    .set(auth(token))
    .send({ email: workEmail, declarationAccepted: true, declarationVersion: 'p7-1' })
    .expect(202);
  await api()
    .post('/registration/work-email/verify')
    .set(auth(token))
    .send({
      email: workEmail,
      declarationAccepted: true,
      declarationVersion: 'p7-1',
      code: email.lastCodeFor(normalized),
    })
    .expect(200);
  await api()
    .put('/registration/consent')
    .set(auth(token))
    .send({ accepted: true, textVersion: 'a9-1' })
    .expect(200);
  await api()
    .put('/registration/profile')
    .set(auth(token))
    .send({ firstName: 'Luca', gender: 'man', interestedIn: 'women', homeCityId: '015146' })
    .expect(200);
  await api()
    .put('/registration/open-space')
    .set(auth(token))
    .send({ enabled: false, textVersion: 'g1' })
    .expect(200);
}

describe("Registrazione con l'email personale fino a pending_approval", () => {
  it("sette passi nell'ordine, poi GET /me con ambito approval", async () => {
    const start = await startWithEmail('luca@personale.example');
    expect(start.result).toBe('created');
    expect(start.session.scope).toBe('registration');
    const token = start.session.accessToken;
    const state = await api().get('/registration').set(auth(token)).expect(200);
    expect(state.body.nextStep).toBe('birthDate');
    await completeSteps(token);
    const other = await f.company();
    const privacy = await api()
      .put('/registration/privacy')
      .set(auth(token))
      .send({ companyIds: [other] })
      .expect(200);
    expect(privacy.body.nextStep).toBe('complete');
    const done = await api().post('/registration/complete').set(auth(token)).expect(200);
    expect(done.body).toMatchObject({ status: 'pending_approval', scope: 'approval' });
    const me = await api().get('/me').set(auth(done.body.accessToken)).expect(200);
    expect(me.body).toMatchObject({
      status: 'pending_approval',
      scope: 'approval',
      signInMethod: 'email',
      openSpaceEnabled: false,
    });
    expect(me.body.company.id).toBe(company);
    // Il vecchio token di registrazione non vale più: l'ambito della sessione è cambiato
    await api().get('/registration').set(auth(token)).expect(401);
    const approval = await api().get('/me/approval').set(auth(done.body.accessToken)).expect(200);
    expect(approval.body).toMatchObject({ status: 'pending', attemptsLeft: 2 });
    // RC-74: aziende escluse in registrazione efficaci subito, senza modifiche in attesa
    expect(
      await count("select count(*) as n from excluded_companies where source = 'registration'"),
    ).toBe(1);
    expect(await count('select count(*) as n from excluded_company_changes')).toBe(0);
    // Nessuna email in chiaro nei codici: solo impronte
    expect(await count("select count(*) as n from otp_codes where recipient_hash like '%@%'")).toBe(
      0,
    );
  });

  it("RC-203 passi fuori ordine e completamento senza la scelta dell'Open space: rifiutati", async () => {
    const { session } = await startWithEmail('anna@personale.example');
    const token = session.accessToken;
    const early = await api()
      .put('/registration/consent')
      .set(auth(token))
      .send({ accepted: true, textVersion: 'a9' })
      .expect(409);
    expect(early.body.error).toMatchObject({
      code: 'registration.stepOrder',
      missing: 'birthDate',
    });
    await api().post('/registration/complete').set(auth(token)).expect(409);
    await completeSteps(token);
    await pool.query("delete from open_space_history where source = 'registration'");
    const missing = await api().post('/registration/complete').set(auth(token)).expect(409);
    expect(missing.body.error.missing).toBe('openSpace');
  });

  it('RC-187 la scelta "Per ora no" scrive la riga dello storico e l\'Open space resta spento', async () => {
    const { session } = await startWithEmail('marta@personale.example');
    await completeSteps(session.accessToken);
    const { rows } = await pool.query<{ enabled: boolean; source: string; text_version: string }>(
      'select enabled, source, text_version from open_space_history',
    );
    expect(rows).toEqual([{ enabled: false, source: 'registration', text_version: 'g1' }]);
  });

  it('RC-205 minorenne al passo 2: account, identità e consensi cancellati subito', async () => {
    const { session } = await startWithEmail('giovane@personale.example');
    const response = await api()
      .put('/registration/birth-date')
      .set(auth(session.accessToken))
      .send({ birthDate: '2012-01-01', termsAccepted: true, termsVersion: 't1' })
      .expect(400);
    expect(response.body.error.code).toBe('registration.underage');
    expect(await count('select count(*) as n from users')).toBe(0);
    expect(await count('select count(*) as n from personal_identities')).toBe(0);
    expect(await count('select count(*) as n from consents')).toBe(0);
  });

  it('i termini non accettati sono rifiutati dalla validazione', async () => {
    const { session } = await startWithEmail('rita@personale.example');
    await api()
      .put('/registration/birth-date')
      .set(auth(session.accessToken))
      .send({ birthDate: '1990-01-01', termsAccepted: false, termsVersion: 't1' })
      .expect(400);
  });
});

describe('Controlli delle email (D24, D224)', () => {
  it("RC-202 email personale con un dominio dell'elenco o usa e getta: rifiutata prima del codice", async () => {
    const work = await api()
      .post('/registration/personal-email')
      .send({ email: `luca@${domain}` })
      .expect(400);
    expect(work.body.error.code).toBe('signIn.error.workEmail');
    const disposable = await api()
      .post('/registration/personal-email')
      .send({ email: 'x@mailinator.com' })
      .expect(400);
    expect(disposable.body.error.code).toBe('signIn.error.disposable');
    expect(email.sent).toHaveLength(0);
    expect(await count('select count(*) as n from otp_codes')).toBe(0);
    await api()
      .post('/registration/personal-email')
      .send({ email: 'abc@privaterelay.appleid.com' })
      .expect(202);
  });

  it('RC-05 e RC-46 passo 3 con provider personale o dominio non in elenco: nessun codice inviato', async () => {
    const { session } = await startWithEmail('luca@personale.example');
    const token = session.accessToken;
    await api()
      .put('/registration/birth-date')
      .set(auth(token))
      .send({ birthDate: '1993-04-12', termsAccepted: true, termsVersion: 't1' })
      .expect(200);
    const sentBefore = email.sent.length;
    const personal = await api()
      .post('/registration/work-email')
      .set(auth(token))
      .send({ email: 'luca@gmail.com', declarationAccepted: true, declarationVersion: 'p7' })
      .expect(400);
    expect(personal.body.error.code).toBe('registration.email.personal');
    const unknown = await api()
      .post('/registration/work-email')
      .set(auth(token))
      .send({
        email: 'luca@sconosciuta.example',
        declarationAccepted: true,
        declarationVersion: 'p7',
      })
      .expect(400);
    expect(unknown.body.error.code).toBe('registration.domain.notListed');
    expect(email.sent.length).toBe(sentBefore);
    const { rows } = await pool.query<{ company_id: string | null; status: string }>(
      'select company_id, status from users',
    );
    expect(rows).toEqual([{ company_id: null, status: 'registering' }]);
  });

  it('RC-04 email aziendale con maiuscole, spazi e punto finale: riconosciuto il dominio', async () => {
    const { session } = await startWithEmail('luca@personale.example');
    await completeSteps(session.accessToken, `  Luca.Conti@ModelloPartners.Example. `.trim());
    const { rows } = await pool.query<{ company_id: string }>('select company_id from users');
    expect(rows[0]!.company_id).toBe(company);
  });

  it('RC-113 e RC-206 email bloccata: stessa risposta prima, registration.blocked dopo la verifica', async () => {
    const address = 'espulso@personale.example';
    await pool.query(
      "insert into blocked_hashes (hash, type, source, expires_at) values ($1, 'personal', 'expulsion', now() + interval '1 year')",
      [crypto.hash('email', address)],
    );
    await api().post('/registration/personal-email').send({ email: address }).expect(202);
    const response = await api()
      .post('/registration/personal-email/verify')
      .send({ email: address, code: email.lastCodeFor(address) })
      .expect(400);
    expect(response.body.error.code).toBe('registration.blocked');
    expect(await count('select count(*) as n from users')).toBe(0);
  });

  it('RC-54 email aziendale già di un altro account: registration.email.inUse dopo la verifica', async () => {
    const first = await startWithEmail('primo@personale.example');
    await completeSteps(first.session.accessToken, `condivisa@${domain}`);
    const second = await startWithEmail('secondo@personale.example');
    const token = second.session.accessToken;
    await api()
      .put('/registration/birth-date')
      .set(auth(token))
      .send({ birthDate: '1993-04-12', termsAccepted: true, termsVersion: 't1' })
      .expect(200);
    const work = `condivisa@${domain}`;
    await waitBetweenCodes();
    await api()
      .post('/registration/work-email')
      .set(auth(token))
      .send({ email: work, declarationAccepted: true, declarationVersion: 'p7' })
      .expect(202);
    const response = await api()
      .post('/registration/work-email/verify')
      .set(auth(token))
      .send({
        email: work,
        declarationAccepted: true,
        declarationVersion: 'p7',
        code: email.lastCodeFor(work),
      })
      .expect(409);
    expect(response.body.error.code).toBe('registration.email.inUse');
  });

  it("RC-207 stessa email personale di nuovo: si entra nell'account esistente, nessun secondo account", async () => {
    await startWithEmail('luca@personale.example');
    await waitBetweenCodes();
    const again = await startWithEmail('luca@personale.example');
    expect(again.result).toBe('existingAccount');
    expect(await count('select count(*) as n from users')).toBe(1);
  });

  it('codice errato cinque volte: il codice non vale più', async () => {
    const address = 'tentativi@personale.example';
    await api().post('/registration/personal-email').send({ email: address }).expect(202);
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/registration/personal-email/verify')
        .send({ email: address, code: '000000' })
        .expect(400);
    }
    const response = await api()
      .post('/registration/personal-email/verify')
      .send({ email: address, code: email.lastCodeFor(address) })
      .expect(400);
    expect(response.body.error.code).toBe('code.expired');
  });
});

describe('Apple e Google (D224, D236)', () => {
  const nonce = async () => (await api().post('/auth/nonce').expect(201)).body.nonce as string;

  it('accesso senza account: noAccount con ticket, poi registrazione con il ticket una sola volta', async () => {
    const value = await nonce();
    const token = await providers.token('apple', {
      sub: 'apple-001',
      email: 'luca@personale.example',
      nonce: value,
    });
    const signIn = await api()
      .post('/auth/apple')
      .send({ identityToken: token, nonce: value })
      .expect(200);
    expect(signIn.body.result).toBe('noAccount');
    const created = await api()
      .post('/registration/apple')
      .send({ registrationTicket: signIn.body.registrationTicket })
      .expect(200);
    expect(created.body.result).toBe('created');
    const again = await api()
      .post('/registration/apple')
      .send({ registrationTicket: signIn.body.registrationTicket })
      .expect(200);
    expect(again.body.result).toBe('existingAccount');
    expect(await count('select count(*) as n from users')).toBe(1);
    const { rows } = await pool.query<{ provider: string; subject: string; email: string }>(
      'select provider, subject, email from personal_identities',
    );
    expect(rows).toEqual([
      { provider: 'apple', subject: 'apple-001', email: 'luca@personale.example' },
    ]);
    // Accesso successivo: entra nell'account in registrazione
    const value2 = await nonce();
    const token2 = await providers.token('apple', {
      sub: 'apple-001',
      email: 'luca@personale.example',
      nonce: value2,
    });
    const login = await api()
      .post('/auth/apple')
      .send({ identityToken: token2, nonce: value2 })
      .expect(200);
    expect(login.body).toMatchObject({ result: 'signedIn', session: { scope: 'registration' } });
  });

  it('RC-202 email nascosta di Apple ammessa; account Google di lavoro rifiutato', async () => {
    const value = await nonce();
    const relay = await providers.token('apple', {
      sub: 'apple-relay',
      email: 'abc123@privaterelay.appleid.com',
      is_private_email: true,
      nonce: value,
    });
    await api()
      .post('/registration/apple')
      .send({ identityToken: relay, nonce: value })
      .expect(200);
    const { rows } = await pool.query<{ is_private_relay: boolean }>(
      'select is_private_relay from personal_identities',
    );
    expect(rows[0]!.is_private_relay).toBe(true);
    const value2 = await nonce();
    const workAccount = await providers.token('google', {
      sub: 'g-1',
      email: `luca@${domain}`,
      nonce: value2,
    });
    const refused = await api()
      .post('/registration/google')
      .send({ identityToken: workAccount, nonce: value2 })
      .expect(400);
    expect(refused.body.error.code).toBe('signIn.error.workAccount');
  });

  it("RC-208 firma errata, aud di un'altra app, scaduto, nonce diverso o riusato: rifiutati", async () => {
    const cases: [string, (n: string) => Promise<string>][] = [
      [
        'firma',
        (n) =>
          providers.token(
            'apple',
            { sub: 's', email: 'a@personale.example', nonce: n },
            { key: providers.attacker },
          ),
      ],
      [
        'aud',
        (n) =>
          providers.token(
            'apple',
            { sub: 's', email: 'a@personale.example', nonce: n },
            { audience: 'altra.app' },
          ),
      ],
      [
        'scaduto',
        (n) =>
          providers.token(
            'apple',
            { sub: 's', email: 'a@personale.example', nonce: n },
            { expiresIn: '-10m' },
          ),
      ],
      [
        'nonce',
        (n) => providers.token('apple', { sub: 's', email: 'a@personale.example', nonce: `${n}x` }),
      ],
      [
        'email',
        (n) =>
          providers.token('apple', {
            sub: 's',
            email: 'a@personale.example',
            email_verified: false,
            nonce: n,
          }),
      ],
    ];
    for (const [, make] of cases) {
      const value = await nonce();
      const response = await api()
        .post('/auth/apple')
        .send({ identityToken: await make(value), nonce: value })
        .expect(401);
      expect(response.body.error.code).toBe('signIn.error.token');
    }
    // Nonce riusato: il primo uso lo consuma
    const value = await nonce();
    const token = await providers.token('google', {
      sub: 'g-2',
      email: 'b@personale.example',
      nonce: value,
    });
    await api().post('/auth/google').send({ identityToken: token, nonce: value }).expect(200);
    await api().post('/auth/google').send({ identityToken: token, nonce: value }).expect(401);
    // Nonce non emesso dal server
    const forged = 'n'.repeat(43);
    const forgedToken = await providers.token('google', {
      sub: 'g-3',
      email: 'c@personale.example',
      nonce: forged,
    });
    await api()
      .post('/auth/google')
      .send({ identityToken: forgedToken, nonce: forged })
      .expect(401);
    // Eventi di sicurezza senza token, `sub` né email
    const { rows } = await pool.query<{ details: Record<string, unknown>; object_id: string }>(
      "select details, object_id from audit_log where action = 'provider_token_rejected'",
    );
    expect(rows.length).toBe(cases.length + 2);
    expect(JSON.stringify(rows)).not.toMatch(/@|personale/);
    expect(await count('select count(*) as n from users')).toBe(0);
  });

  it("Proposta 4: l'email personale di un account Google non apre una sessione con il codice", async () => {
    const value = await nonce();
    const token = await providers.token('google', {
      sub: 'g-9',
      email: 'gmail@personale.example',
      nonce: value,
    });
    await api()
      .post('/registration/google')
      .send({ identityToken: token, nonce: value })
      .expect(200);
    await api().post('/auth/code').send({ email: 'gmail@personale.example' }).expect(202);
    const response = await api()
      .post('/auth/verify')
      .send({
        email: 'gmail@personale.example',
        code: email.lastCodeFor('gmail@personale.example'),
      })
      .expect(409);
    expect(response.body.error.code).toBe('signIn.error.emailInUse');
    // Stessa email con il codice in registrazione: email già usata dopo la verifica
    await waitBetweenCodes();
    await api()
      .post('/registration/personal-email')
      .send({ email: 'gmail@personale.example' })
      .expect(202);
    const reg = await api()
      .post('/registration/personal-email/verify')
      .send({
        email: 'gmail@personale.example',
        code: email.lastCodeFor('gmail@personale.example'),
      })
      .expect(409);
    expect(reg.body.error.code).toBe('signIn.error.emailInUse');
  });
});

describe('Accesso con il codice e sessioni (D82, D231)', () => {
  it('stessa risposta per indirizzi sconosciuti, nessun codice inviato', async () => {
    const response = await api()
      .post('/auth/code')
      .send({ email: 'nessuno@personale.example' })
      .expect(202);
    expect(response.body).toEqual({ status: 'sent' });
    expect(email.sent).toHaveLength(0);
  });

  it("accesso con l'email aziendale attiva dal mittente neutro", async () => {
    const userId = await f.user(company);
    const { rows } = await pool.query<{ email: string }>(
      'select email from work_emails where user_id = $1',
      [userId],
    );
    const work = rows[0]!.email;
    await pool.query('update work_emails set email_hash = $2 where user_id = $1', [
      userId,
      crypto.hash('email', work),
    ]);
    await api().post('/auth/code').send({ email: work }).expect(202);
    expect(email.sent.at(-1)!.from).toBe('neutral');
    const response = await api()
      .post('/auth/verify')
      .send({ email: work, code: email.lastCodeFor(work) })
      .expect(200);
    expect(response.body.session.scope).toBe('full');
  });

  it("rinnovo con rotazione; il riuso del token sostituito revoca l'intera sessione", async () => {
    const { session } = await startWithEmail('rinnovo@personale.example');
    const first = await api()
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(200);
    expect(first.body.refreshToken).not.toBe(session.refreshToken);
    await api().get('/me').set(auth(first.body.accessToken)).expect(200);
    await api().post('/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await api().post('/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
    await api().get('/me').set(auth(first.body.accessToken)).expect(401);
    expect(
      await count("select count(*) as n from audit_log where action = 'refresh_token_reused'"),
    ).toBe(1);
  });

  it('uscita: il token di accesso non vale più; senza token 401; ambito sbagliato 403', async () => {
    const { session } = await startWithEmail('uscita@personale.example');
    await api().get('/me').expect(401);
    await api().get('/me/approval').set(auth(session.accessToken)).expect(403);
    await api().post('/auth/logout').set(auth(session.accessToken)).send({}).expect(204);
    await api().get('/me').set(auth(session.accessToken)).expect(401);
  });

  it('RC-209 un account dimostrativo non si raggiunge con Apple o Google', async () => {
    const demo = await f.user(await f.company({ isDemo: true }), { isDemo: true });
    await pool.query(
      "update personal_identities set provider = 'google', subject = 'g-demo' where user_id = $1",
      [demo],
    );
    const value = (await api().post('/auth/nonce').expect(201)).body.nonce as string;
    const token = await providers.token('google', {
      sub: 'g-demo',
      email: `persona-${demo}@personale.example`,
      nonce: value,
    });
    const response = await api()
      .post('/auth/google')
      .send({ identityToken: token, nonce: value })
      .expect(200);
    expect(response.body.result).toBe('noAccount');
  });
});

describe('Elenchi consultabili', () => {
  it('RC-56 elenco delle aziende: solo attive del proprio tipo e diverse dalla propria, solo il nome', async () => {
    const { session } = await startWithEmail('elenco@personale.example');
    await completeSteps(session.accessToken);
    await f.company({ isDemo: true });
    const other = await f.company();
    const list = await api().get('/companies').set(auth(session.accessToken)).expect(200);
    const ids = (list.body as { id: string; name: string }[]).map((item) => item.id);
    expect(ids).toContain(other);
    expect(ids).not.toContain(company);
    expect(Object.keys(list.body[0] as object).sort()).toEqual(['id', 'name']);
    const cities = await api().get('/cities?search=mil').set(auth(session.accessToken)).expect(200);
    expect(cities.body[0]).toEqual({ id: '015146', name: 'Milano', provinceCode: 'MI' });
  });
});
