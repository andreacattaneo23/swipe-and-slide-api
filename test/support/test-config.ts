import { type AppConfig, loadConfig } from '../../src/infra/config/config';
import { TEST_DATABASE_URL } from './test-db';

const SECRET = 'test-secret-'.padEnd(40, 'x');

/**
 * Configurazione dei test: email nel log, nessun Redis, audience di prova dei fornitori e il
 * ruolo del database del servizio (`app_role`, `backoffice_role`), così i test verificano anche
 * i permessi.
 */
export function testConfig(role: 'app' | 'admin' = 'app'): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    SERVICE_ROLE: role,
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_ROLE: role === 'app' ? 'app_role' : 'backoffice_role',
    JWT_ACCESS_SIGNING_KEY: `${SECRET}a`,
    JWT_ADMIN_SIGNING_KEY: `${SECRET}b`,
    HMAC_SECRET: `${SECRET}c`,
    TOKEN_ENCRYPTION_KEY: `${SECRET}d`,
    TOTP_ENCRYPTION_KEY: `${SECRET}e`,
    EMAIL_TRANSPORT: 'log',
    APPLE_BUNDLE_ID: 'it.swipeandslide.app',
    APPLE_SERVICES_ID: 'it.swipeandslide.web',
    GOOGLE_CLIENT_ID_WEB: 'test-google-web',
  });
}
