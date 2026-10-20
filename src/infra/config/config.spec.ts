import { loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://x@localhost/x',
  JWT_ACCESS_SIGNING_KEY: 'a'.repeat(32),
  JWT_ADMIN_SIGNING_KEY: 'b'.repeat(32),
  HMAC_SECRET: 'c'.repeat(32),
  TOKEN_ENCRYPTION_KEY: 'd'.repeat(32),
  TOTP_ENCRYPTION_KEY: 'e'.repeat(32),
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

  it('vieta le email nel log in produzione', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', EMAIL_TRANSPORT: 'log' })).toThrow(
      'EMAIL_TRANSPORT',
    );
  });
});
