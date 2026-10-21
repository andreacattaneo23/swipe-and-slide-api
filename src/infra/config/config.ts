// Configurazione del servizio letta dalle variabili d'ambiente (README, "Variabili
// d'ambiente"). In produzione i segreti arrivano da Secret Manager; in locale da `.env`.
// Nessun valore segreto ha un default: se manca, il servizio non parte.
import { AdapterConfig, loadAdapterConfig } from './adapters-config';

export type ServiceRole = 'app' | 'admin' | 'realtime';
export type EmailTransport = 'smtp' | 'brevo';

export interface AppConfig {
  nodeEnv: string;
  serviceRole: ServiceRole;
  port: number;
  logLevel: string;
  databaseUrl: string;
  /** Ruolo del database impostato con `SET ROLE` a ogni connessione (es. `app_role`). */
  databaseRole: string | null;
  redisUrl: string | null;
  jwtAccessSigningKey: string;
  jwtAdminSigningKey: string;
  hmacSecret: string;
  hmacSecretVersion: string;
  /** Chiave locale per cifrare i token dei fornitori (segreto del server; OpenBao proposto, D241). */
  tokenEncryptionKey: string;
  emailTransport: EmailTransport;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    password: string | null;
  };
  brevoApiKey: string | null;
  emailFromNeutral: string;
  emailFromProject: string;
  apple: { audiences: string[]; jwksUrl: string; issuer: string };
  /** Indirizzo dell'app a cui torna il flusso web di Apple (D228). */
  appleWebReturnUrl: string;
  google: { audiences: string[]; jwksUrl: string; issuers: string[] };
  /**
   * Archivio delle foto e delle esportazioni, compatibile S3 (D240): MinIO in locale, Cloudflare
   * R2 in produzione, con lo stesso client.
   */
  storage: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    forcePathStyle: boolean;
  };
  /** Credenziali di Google Cloud Vision (D73): senza, le foto vanno solo in revisione manuale. */
  visionCredentials: string | null;
  visionEndpoint: string;
  /** Origini ammesse dal CORS, solo sulle rotte della cancellazione web (D231). */
  corsAllowedOrigins: string[];
  /**
   * Solo sviluppo e test: origini dell'app web (export di Expo) ammesse dal CORS su tutte le rotte
   * di `app-api`, mai `*`; in produzione è sempre vuoto (D231).
   */
  devCorsOrigins: string[];
  /** Altri servizi esterni: custodia locale della chiave, Cloudflare Access, avvisi al team. */
  adapters: AdapterConfig;
}

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key];
  if (!value) throw new Error(`Variabile d'ambiente mancante: ${key}`);
  return value;
};

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const serviceRole = (env.SERVICE_ROLE ?? 'app') as ServiceRole;
  if (!['app', 'admin', 'realtime'].includes(serviceRole)) {
    throw new Error(`SERVICE_ROLE non valido: ${serviceRole}`);
  }
  const defaultPort = { app: 3000, admin: 3001, realtime: 3002 }[serviceRole];
  // Nessun invio simulato (D240): SMTP (Mailpit in locale, Brevo in produzione) o l'API di Brevo
  const emailTransport = (env.EMAIL_TRANSPORT ?? 'smtp') as EmailTransport;
  if (!['smtp', 'brevo'].includes(emailTransport)) {
    throw new Error(`EMAIL_TRANSPORT non valido: ${emailTransport}`);
  }
  const secretMin = (key: string): string => {
    const value = required(env, key);
    if (value.length < 32) throw new Error(`${key} deve avere almeno 32 caratteri`);
    return value;
  };
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    serviceRole,
    port: Number(env.PORT ?? defaultPort),
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseRole: env.DATABASE_ROLE || null,
    redisUrl: env.REDIS_URL || null,
    jwtAccessSigningKey: secretMin('JWT_ACCESS_SIGNING_KEY'),
    jwtAdminSigningKey: secretMin('JWT_ADMIN_SIGNING_KEY'),
    hmacSecret: secretMin('HMAC_SECRET'),
    hmacSecretVersion: env.HMAC_SECRET_VERSION ?? 'v1',
    tokenEncryptionKey: secretMin('TOKEN_ENCRYPTION_KEY'),
    emailTransport,
    smtp: {
      host: env.SMTP_HOST || '127.0.0.1',
      port: Number(env.SMTP_PORT || 1025),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || null,
      password: env.SMTP_PASSWORD || null,
    },
    brevoApiKey: env.BREVO_API_KEY || null,
    emailFromNeutral: env.EMAIL_FROM_NEUTRAL ?? 'codici@example.invalid',
    emailFromProject: env.EMAIL_FROM_PROJECT ?? 'ciao@example.invalid',
    apple: {
      audiences: list(env.APPLE_BUNDLE_ID).concat(list(env.APPLE_SERVICES_ID)),
      jwksUrl: env.APPLE_JWKS_URL ?? 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
    },
    appleWebReturnUrl: env.APPLE_WEB_RETURN_URL || 'swipeandslide://auth/apple',
    google: {
      audiences: list(env.GOOGLE_CLIENT_ID_WEB)
        .concat(list(env.GOOGLE_CLIENT_ID_IOS))
        .concat(list(env.GOOGLE_CLIENT_ID_ANDROID)),
      jwksUrl: env.GOOGLE_JWKS_URL ?? 'https://www.googleapis.com/oauth2/v3/certs',
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
    },
    storage: {
      endpoint: env.S3_ENDPOINT || 'http://127.0.0.1:9100',
      region: env.S3_REGION || 'auto',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      bucket: env.S3_BUCKET || 'swipe-slide',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    },
    visionCredentials: env.GOOGLE_APPLICATION_CREDENTIALS || null,
    visionEndpoint: env.VISION_API_ENDPOINT || 'eu-vision.googleapis.com',
    corsAllowedOrigins: list(env.CORS_ALLOWED_ORIGINS),
    devCorsOrigins: devCorsOrigins(env, env.NODE_ENV ?? 'development'),
    adapters: loadAdapterConfig(env, {
      fallbackSecret: secretMin('TOKEN_ENCRYPTION_KEY'),
    }),
  };
}

/** Origini dell'app web in sviluppo: `CORS_DEV_ORIGINS`, di base le porte dell'export di Expo. */
function devCorsOrigins(env: NodeJS.ProcessEnv, nodeEnv: string): string[] {
  if (nodeEnv === 'production') {
    if (env.CORS_DEV_ORIGINS) throw new Error('CORS_DEV_ORIGINS non è ammessa in produzione');
    return [];
  }
  const origins =
    env.CORS_DEV_ORIGINS === undefined
      ? ['http://localhost:8081', 'http://localhost:8082', 'http://localhost:8090']
      : list(env.CORS_DEV_ORIGINS);
  if (origins.includes('*')) throw new Error('CORS_DEV_ORIGINS non accetta *');
  return origins;
}

/** Token di iniezione della configurazione. */
export const APP_CONFIG = Symbol('APP_CONFIG');
