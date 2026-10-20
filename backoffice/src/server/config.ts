/**
 * Configurazione del backoffice dalle variabili d'ambiente (elenco in .env.example). In
 * produzione i segreti vengono da Secret Manager; senza quelli obbligatori il server non parte.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';

export type AdminApiAdapter = 'mock' | 'http';

export interface BackofficeConfig {
  adapter: AdminApiAdapter;
  adminApiUrl: string | null;
  adminApiIam: boolean;
  sessionSecret: Buffer;
  secureCookies: boolean;
  production: boolean;
}

const globalForConfig = globalThis as typeof globalThis & { __backofficeDevSecret?: Buffer };

export function readConfig(env: NodeJS.ProcessEnv = process.env): BackofficeConfig {
  const production = env.NODE_ENV === 'production';
  const adapter = (env.ADMIN_API_ADAPTER || 'mock') as AdminApiAdapter;
  if (adapter !== 'mock' && adapter !== 'http') {
    throw new Error(`ADMIN_API_ADAPTER non valido: ${adapter} (ammessi: mock, http)`);
  }
  const adminApiUrl = env.ADMIN_API_URL?.trim() || null;
  if (adapter === 'http' && !adminApiUrl) {
    throw new Error("ADMIN_API_URL è obbligatoria con l'adattatore http");
  }
  if (production && adapter === 'mock' && env.ALLOW_MOCK_IN_PRODUCTION !== 'true') {
    throw new Error("L'adattatore mock non si usa in produzione");
  }

  let sessionSecret: Buffer;
  if (env.SESSION_SECRET) {
    sessionSecret = Buffer.from(env.SESSION_SECRET, 'base64');
    if (sessionSecret.length !== 32) {
      throw new Error('SESSION_SECRET deve essere di 32 byte in base64 (openssl rand -base64 32)');
    }
  } else if (production) {
    throw new Error('SESSION_SECRET è obbligatoria in produzione');
  } else {
    // In sviluppo un segreto casuale per processo: le sessioni finiscono al riavvio.
    globalForConfig.__backofficeDevSecret ??= randomBytes(32);
    sessionSecret = globalForConfig.__backofficeDevSecret;
  }

  return {
    adapter,
    adminApiUrl,
    adminApiIam: env.ADMIN_API_IAM === 'true',
    sessionSecret,
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    production,
  };
}
