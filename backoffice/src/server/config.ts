/**
 * Configurazione del backoffice dalle variabili d'ambiente (elenco in .env.example). Il backoffice
 * parla solo con admin-api vera (D240): in sviluppo quella locale sulla porta 3001, in produzione
 * l'URL del servizio privato, obbligatorio. I segreti vengono da Secret Manager; senza quelli
 * obbligatori il server non parte.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';

/** admin-api in sviluppo (D238: porta 3001). */
export const LOCAL_ADMIN_API_URL = 'http://localhost:3001';

export interface BackofficeConfig {
  adminApiUrl: string;
  adminApiIam: boolean;
  sessionSecret: Buffer;
  secureCookies: boolean;
  production: boolean;
}

const globalForConfig = globalThis as typeof globalThis & { __backofficeDevSecret?: Buffer };

export function readConfig(env: NodeJS.ProcessEnv = process.env): BackofficeConfig {
  const production = env.NODE_ENV === 'production';
  const configuredUrl = env.ADMIN_API_URL?.trim() || null;
  if (production && !configuredUrl) {
    throw new Error('ADMIN_API_URL è obbligatoria in produzione');
  }
  const adminApiUrl = configuredUrl ?? LOCAL_ADMIN_API_URL;
  if (!/^https?:\/\//.test(adminApiUrl)) {
    throw new Error(`ADMIN_API_URL non valida: ${adminApiUrl}`);
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
    adminApiUrl,
    adminApiIam: env.ADMIN_API_IAM === 'true',
    sessionSecret,
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
    production,
  };
}
