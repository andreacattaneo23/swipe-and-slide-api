// Ritorno del flusso web di Apple (D228): il modulo di Apple torna all'app, senza salvare nulla.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from '../support/test-app';

let app: INestApplication<App>;

beforeAll(async () => {
  ({ app } = await createTestApp('app'));
});

afterAll(async () => {
  await app.close();
});

describe('POST /auth/apple/web-callback', () => {
  it("rimanda all'app con il token e lo stato nel frammento", async () => {
    const token = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJh';
    const res = await request(app.getHttpServer())
      .post('/auth/apple/web-callback')
      .type('form')
      .send({ id_token: token, code: 'c1', state: 'stato-123', user: '{"name":{}}' })
      .expect(303);
    expect(res.headers.location).toBe(
      `swipeandslide://auth/apple#id_token=${token}&state=stato-123`,
    );
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('con un risultato non valido o annullato rimanda un errore, mai il contenuto ricevuto', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/apple/web-callback')
      .type('form')
      .send({ error: 'user_cancelled_authorize', state: 'stato-123' })
      .expect(303);
    expect(res.headers.location).toBe('swipeandslide://auth/apple#error=cancelled&state=stato-123');
    const bad = await request(app.getHttpServer())
      .post('/auth/apple/web-callback')
      .type('form')
      .send({ id_token: '<script>', state: 'x y' })
      .expect(303);
    expect(bad.headers.location).toBe('swipeandslide://auth/apple#error=invalid');
  });
});
