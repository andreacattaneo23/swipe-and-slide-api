// Prova end to end dell'accesso degli operatori sul sistema vero (D240): admin-api con
// PostgreSQL, MinIO e l'invio SMTP verso Mailpit; il codice si legge dall'API di Mailpit
// (`MAILPIT_URL`, di base http://127.0.0.1:8025). Nessun secondo fattore (D244).
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AdminApiModule } from '../../src/admin/admin-api.module';
import { setupApp } from '../../src/infra/http/setup-app';
import { testConfig } from '../support/test-config';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
let app: INestApplication<App>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AdminApiModule.forRoot(testConfig('admin'))],
  }).compile();
  app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  setupApp(app);
  await app.init();
  await truncateAll(pool);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

interface MailpitList {
  messages: { ID: string; To: { Address: string }[]; Created: string }[];
}

/** Ultimo codice di 6 cifre arrivato a un indirizzo, con qualche secondo di attesa. */
async function codeFromMailpit(address: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = (await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
    ).json()) as MailpitList;
    const message = list.messages[0];
    if (message) {
      const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json()) as {
        Text: string;
      };
      const code = /\b(\d{6})\b/.exec(detail.Text)?.[1];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Nessun codice per ${address} in Mailpit`);
}

describe('Accesso degli operatori con Mailpit (D88, D240)', () => {
  it('codice dall’email vera e sessione; poi le rotte del backoffice', async () => {
    const address = `e2e-${Date.now()}@backoffice.example`;
    await pool.query(
      `insert into operators (email, name, roles)
       values ($1, 'Operatore e2e', '{admin,moderator,support}')`,
      [address],
    );
    const api = () => request(app.getHttpServer());
    await api().post('/backoffice/auth/code').send({ email: address }).expect(202);
    const code = await codeFromMailpit(address);
    const session = await api()
      .post('/backoffice/auth/verify')
      .send({ email: address, code })
      .expect(200);
    expect(session.body.operator).toMatchObject({ name: 'Operatore e2e' });
    const auth = { 'X-Operator-Token': session.body.token as string };
    await api().get('/backoffice/auth/me').set(auth).expect(200);
    await api().get('/backoffice/moderation/queue').set(auth).expect(200);
    await api().get('/backoffice/stats').set(auth).expect(200);
    // Il codice dell'email è consumato: non apre una seconda sessione
    await api().post('/backoffice/auth/verify').send({ email: address, code }).expect(401);
  });
});
