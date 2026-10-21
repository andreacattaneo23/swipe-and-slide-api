// CORS dell'app web in sviluppo (export di Expo): solo le origini elencate, mai `*` (D231).
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createTestApp } from '../support/test-app';

let app: INestApplication<App>;
let admin: INestApplication<App>;

beforeAll(async () => {
  ({ app } = await createTestApp('app'));
  ({ app: admin } = await createTestApp('admin'));
});

afterAll(async () => {
  await app.close();
  await admin.close();
});

describe('CORS in sviluppo', () => {
  it("risponde all'origine dell'app web e a nessun'altra", async () => {
    const preflight = await request(app.getHttpServer())
      .options('/me')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
    const other = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it("admin-api non risponde mai alle origini dell'app", async () => {
    const res = await request(admin.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:8081');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
