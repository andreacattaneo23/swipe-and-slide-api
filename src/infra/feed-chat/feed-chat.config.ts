import { createHash } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/config';

/**
 * Configurazione dei servizi esterni di feed, chat e tempo reale (team B2, D239–D241), letta dalle
 * variabili d'ambiente accanto a `AppConfig`. Tutto reale anche in locale: Redis (Valkey in
 * produzione, solo comandi compatibili), Expo Push, cifratura a busta con la chiave principale da
 * `MESSAGE_MASTER_KEY` in sviluppo e da OpenBao transit in produzione.
 */
export type KeyCustody = 'env' | 'openbao';

export interface FeedChatConfig {
  /** `env`: chiave principale da variabile (sviluppo, D240); `openbao`: transit (D241). */
  keyCustody: KeyCustody;
  /** Chiave principale da `MESSAGE_MASTER_KEY` (almeno 32 caratteri), solo con `env`. */
  masterKey: Buffer | null;
  openbao: { address: string | null; token: string | null; transitKey: string | null };
  /** Token di accesso di Expo Push, facoltativo (sicurezza avanzata delle push). */
  expoAccessToken: string | null;
  /** Identificativo dell'istanza del servizio `realtime`, per la presenza tecnica (D229). */
  instanceId: string;
}

export const FEED_CHAT_CONFIG = Symbol('FEED_CHAT_CONFIG');

export function loadFeedChatConfig(
  base: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): FeedChatConfig {
  const production = base.nodeEnv === 'production';
  const keyCustody = (env.KEY_CUSTODY ?? (production ? 'openbao' : 'env')) as KeyCustody;
  if (!['env', 'openbao'].includes(keyCustody)) {
    throw new Error(`KEY_CUSTODY non valida: ${keyCustody}`);
  }
  if (keyCustody === 'env' && production) {
    throw new Error('KEY_CUSTODY=env non è ammessa in produzione');
  }
  const masterKey = env.MESSAGE_MASTER_KEY;
  if (masterKey && masterKey.length < 32) {
    throw new Error('MESSAGE_MASTER_KEY deve avere almeno 32 caratteri');
  }
  if (!base.redisUrl) throw new Error('REDIS_URL mancante: il tempo reale usa Redis (D182, D240)');
  return {
    keyCustody,
    masterKey: masterKey ? createHash('sha256').update(masterKey).digest() : null,
    openbao: {
      address: env.OPENBAO_ADDR || null,
      token: env.OPENBAO_TOKEN || null,
      transitKey: env.OPENBAO_TRANSIT_KEY || null,
    },
    expoAccessToken: env.EXPO_ACCESS_TOKEN || null,
    instanceId:
      env.REALTIME_INSTANCE_ID || `rt-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/** Provider da usare nei moduli: dipende solo dalla configurazione del servizio. */
export const feedChatConfigProvider = {
  provide: FEED_CHAT_CONFIG,
  inject: [APP_CONFIG],
  useFactory: (base: AppConfig) => loadFeedChatConfig(base),
};
