import { loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://x@localhost/x',
  JWT_ACCESS_SIGNING_KEY: 'a'.repeat(32),
  JWT_ADMIN_SIGNING_KEY: 'b'.repeat(32),
  HMAC_SECRET: 'c'.repeat(32),
  TOKEN_ENCRYPTION_KEY: 'd'.repeat(32),
  S3_ENDPOINT: 'http://127.0.0.1:9100',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
};

describe('loadConfig', () => {
  it('sceglie la porta secondo SERVICE_ROLE', () => {
    expect(loadConfig({ ...base, SERVICE_ROLE: 'app' }).port).toBe(3000);
    expect(loadConfig({ ...base, SERVICE_ROLE: 'admin' }).port).toBe(3001);
  });

  it('rifiuta segreti mancanti o corti e ruoli sconosciuti', () => {
    expect(() => loadConfig({ ...base, HMAC_SECRET: 'corto' })).toThrow('HMAC_SECRET');
    expect(() => loadConfig({ ...base, JWT_ACCESS_SIGNING_KEY: undefined })).toThrow(
      'JWT_ACCESS_SIGNING_KEY',
    );
    expect(() => loadConfig({ ...base, SERVICE_ROLE: 'altro' })).toThrow('SERVICE_ROLE');
  });

  it('non ammette invii simulati: niente email nel log (D240)', () => {
    expect(() => loadConfig({ ...base, EMAIL_TRANSPORT: 'log' })).toThrow('EMAIL_TRANSPORT');
    expect(loadConfig(base).emailTransport).toBe('smtp');
  });

  it("CORS dell'app web solo in sviluppo, mai * né in produzione (D231)", () => {
    expect(loadConfig(base).devCorsOrigins).toEqual([
      'http://localhost:8081',
      'http://localhost:8082',
      'http://localhost:8090',
    ]);
    expect(
      loadConfig({ ...base, CORS_DEV_ORIGINS: 'http://localhost:19006' }).devCorsOrigins,
    ).toEqual(['http://localhost:19006']);
    expect(() => loadConfig({ ...base, CORS_DEV_ORIGINS: '*' })).toThrow('CORS_DEV_ORIGINS');
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', CORS_DEV_ORIGINS: 'http://localhost:8081' }),
    ).toThrow('CORS_DEV_ORIGINS');
  });
});
