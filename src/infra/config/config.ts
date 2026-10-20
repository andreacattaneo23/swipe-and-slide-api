// Configurazione del servizio letta dalle variabili d'ambiente (README, "Variabili
// d'ambiente"). In produzione i segreti arrivano da Secret Manager; in locale da `.env`.
// Nessun valore segreto ha un default: se manca, il servizio non parte.

export type ServiceRole = 'app' | 'admin' | 'realtime';
export type EmailTransport = 'log' | 'brevo';

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
  /** Chiave locale per cifrare segreti TOTP e token dei fornitori (in produzione Cloud KMS). */
  tokenEncryptionKey: string;
  totpEncryptionKey: string;
  emailTransport: EmailTransport;
  brevoApiKey: string | null;
  emailFromNeutral: string;
  emailFromProject: string;
  apple: { audiences: string[]; jwksUrl: string; issuer: string };
  google: { audiences: string[]; jwksUrl: string; issuers: string[] };
  /** Solo sviluppo: accesso degli operatori senza IAM di Cloud Run. */
  backofficeServiceAccount: string | null;
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
  const emailTransport = (env.EMAIL_TRANSPORT ?? 'log') as EmailTransport;
  if (emailTransport === 'log' && env.NODE_ENV === 'production') {
    throw new Error('EMAIL_TRANSPORT=log non è ammesso in produzione');
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
    totpEncryptionKey: secretMin('TOTP_ENCRYPTION_KEY'),
    emailTransport,
    brevoApiKey: env.BREVO_API_KEY || null,
    emailFromNeutral: env.EMAIL_FROM_NEUTRAL ?? 'codici@example.invalid',
    emailFromProject: env.EMAIL_FROM_PROJECT ?? 'ciao@example.invalid',
    apple: {
      audiences: list(env.APPLE_BUNDLE_ID).concat(list(env.APPLE_SERVICES_ID)),
      jwksUrl: env.APPLE_JWKS_URL ?? 'https://appleid.apple.com/auth/keys',
      issuer: 'https://appleid.apple.com',
    },
    google: {
      audiences: list(env.GOOGLE_CLIENT_ID_WEB)
        .concat(list(env.GOOGLE_CLIENT_ID_IOS))
        .concat(list(env.GOOGLE_CLIENT_ID_ANDROID)),
      jwksUrl: env.GOOGLE_JWKS_URL ?? 'https://www.googleapis.com/oauth2/v3/certs',
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
    },
    backofficeServiceAccount: env.BACKOFFICE_SERVICE_ACCOUNT || null,
  };
}

/** Token di iniezione della configurazione. */
export const APP_CONFIG = Symbol('APP_CONFIG');
