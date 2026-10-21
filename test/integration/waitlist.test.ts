// Lista d'attesa (D95, P13): richiesta con un dominio non in elenco e conferma dell'email di
// contatto con il codice; il backoffice vede solo i gruppi per dominio confermati.
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { CaptureEmailSender } from '../support/capture-email-sender';
import { createTestApp } from '../support/test-app';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
let app: INestApplication<App>;
let email: CaptureEmailSender;

beforeAll(async () => {
  ({ app, email } = await createTestApp('app'));
});

beforeEach(async () => {
  await truncateAll(pool);
  email.sent.length = 0;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('POST /waitlist e POST /waitlist/confirm (D95)', () => {
  it('richiesta e conferma con il codice; il codice sbagliato non conferma', async () => {
    const api = () => request(app.getHttpServer());
    const contact = `contatto-${Date.now()}@personale.example`;
    await api()
      .post('/waitlist')
      .send({
        domain: 'studio-nuovo.example',
        suggestedName: 'Studio Nuovo',
        contactEmail: contact,
      })
      .expect(202);
    const code = email.lastCodeFor(contact);
    expect(code).toMatch(/^\d{6}$/);
    await api()
      .post('/waitlist/confirm')
      .send({ contactEmail: contact, code: code === '000000' ? '111111' : '000000' })
      .expect(400);
    await api().post('/waitlist/confirm').send({ contactEmail: contact, code }).expect(204);
    const { rows } = await pool.query<{ confirmed: boolean }>(
      'select contact_confirmed_at is not null as confirmed from waitlist_requests where contact_email = $1',
      [contact],
    );
    expect(rows).toEqual([{ confirmed: true }]);
  });

  it('i provider personali ricevono la spiegazione, senza lista d’attesa', async () => {
    await request(app.getHttpServer())
      .post('/waitlist')
      .send({ domain: 'gmail.com', contactEmail: 'qualcuno@gmail.com' })
      .expect(400);
  });
});
