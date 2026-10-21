import { type AppConfig, loadConfig } from '../../src/infra/config/config';
import { TEST_DATABASE_URL } from './test-db';

/** Bucket dei test, creato dal setup globale. */
export const TEST_BUCKET = process.env.TEST_S3_BUCKET ?? 'swipe-slide-test';

const SECRET = 'test-secret-'.padEnd(40, 'x');

/**
 * Configurazione dei test: email via SMTP a Mailpit, archivio su MinIO, Redis vero
 * (`TEST_REDIS_URL`, di base quello locale, D240), chiave principale dei messaggi di prova,
 * audience di prova dei fornitori e il ruolo del database del servizio (`app_role`,
 * `backoffice_role`), così i test verificano anche i permessi.
 */
export function testConfig(role: 'app' | 'admin' = 'app'): AppConfig {
  // Chiave principale dei messaggi nei test: cifratura vera con una chiave di prova
  process.env.MESSAGE_MASTER_KEY ??= `${SECRET}kms`;
  return loadConfig({
    NODE_ENV: 'test',
    SERVICE_ROLE: role,
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_ROLE: role === 'app' ? 'app_role' : 'backoffice_role',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
    JWT_ACCESS_SIGNING_KEY: `${SECRET}a`,
    JWT_ADMIN_SIGNING_KEY: `${SECRET}b`,
    HMAC_SECRET: `${SECRET}c`,
    TOKEN_ENCRYPTION_KEY: `${SECRET}d`,
    EMAIL_TRANSPORT: 'smtp',
    SMTP_HOST: process.env.SMTP_HOST ?? '127.0.0.1',
    SMTP_PORT: process.env.SMTP_PORT ?? '1025',
    // Archivio vero (D240): MinIO locale con un bucket dei test
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9100',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: TEST_BUCKET,
    // Cloudflare Access spento solo esplicitamente, come in sviluppo (D241)
    CF_ACCESS_DISABLED: 'true',
    KEY_CUSTODY: 'env',
    APPLE_BUNDLE_ID: 'it.swipeandslide.app',
    APPLE_SERVICES_ID: 'it.swipeandslide.web',
    GOOGLE_CLIENT_ID_WEB: 'test-google-web',
  });
}
