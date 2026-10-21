import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { CaptureEmailSender } from './capture-email-sender';

export interface TestOperator {
  id: string;
  token: string;
  auth: { 'X-Operator-Token': string };
}

/** Operatore con i ruoli indicati, entrato con l'email e il codice come nel backoffice (D244). */
export async function loginOperator(
  app: INestApplication<App>,
  pool: Pool,
  email: CaptureEmailSender,
  roles: string[] = ['admin', 'moderator', 'support'],
): Promise<TestOperator> {
  const address = `op-${roles.join('-')}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@backoffice.example`;
  const { rows } = await pool.query<{ id: string }>(
    'insert into operators (email, name, roles) values ($1, $2, $3) returning id',
    [address, 'Operatore', `{${roles.join(',')}}`],
  );
  await request(app.getHttpServer())
    .post('/backoffice/auth/code')
    .send({ email: address })
    .expect(202);
  const response = await request(app.getHttpServer())
    .post('/backoffice/auth/verify')
    .send({ email: address, code: email.lastCodeFor(address) })
    .expect(200);
  const token = response.body.token as string;
  return { id: rows[0]!.id, token, auth: { 'X-Operator-Token': token } };
}
