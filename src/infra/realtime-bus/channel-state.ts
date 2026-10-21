import Redis from 'ioredis';

/**
 * Stato tecnico dei canali nella cache L2 (D229, D230, D231): presenza per decidere le push e
 * sessioni revocate per chiudere i canali. Mai mostrato agli utenti né esposto da un'API. Con
 * Redis non raggiungibile la presenza vale "non connesso" (parte la push) e le sessioni valgono
 * revocate (il canale si rifiuta): nel dubbio si nega (D233).
 */
export abstract class ChannelState {
  /** Registra un canale aperto di un utente su un'istanza. */
  abstract addPresence(userId: string, channelKey: string): Promise<void>;
  abstract removePresence(userId: string, channelKey: string): Promise<void>;
  /** Rinnova la presenza dei canali ancora aperti (battito). */
  abstract refreshPresence(entries: { userId: string; channelKey: string }[]): Promise<void>;
  abstract isConnected(userId: string): Promise<boolean>;
  /** Segna una sessione come revocata fino alla scadenza dei suoi token di accesso. */
  abstract revokeSession(sessionId: string): Promise<void>;
  abstract isSessionRevoked(sessionId: string): Promise<boolean>;
  abstract close(): Promise<void>;
}

/** Durata della presenza senza battito e della memoria delle sessioni revocate. */
export const PRESENCE_TTL_SECONDS = 90;
export const REVOKED_TTL_SECONDS = 15 * 60;

export class RedisChannelState extends ChannelState {
  private readonly redis: Redis;

  constructor(url: string) {
    super();
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      lazyConnect: true,
    });
    this.redis.on('error', () => undefined);
  }

  async addPresence(userId: string, channelKey: string): Promise<void> {
    await this.safe(async () => {
      await this.redis
        .multi()
        .hset(`rt:presence:${userId}`, channelKey, Date.now() + PRESENCE_TTL_SECONDS * 1000)
        .expire(`rt:presence:${userId}`, PRESENCE_TTL_SECONDS)
        .exec();
    });
  }

  async removePresence(userId: string, channelKey: string): Promise<void> {
    await this.safe(() => this.redis.hdel(`rt:presence:${userId}`, channelKey));
  }

  async refreshPresence(entries: { userId: string; channelKey: string }[]): Promise<void> {
    if (entries.length === 0) return;
    await this.safe(async () => {
      const pipeline = this.redis.pipeline();
      const until = Date.now() + PRESENCE_TTL_SECONDS * 1000;
      for (const entry of entries) {
        pipeline.hset(`rt:presence:${entry.userId}`, entry.channelKey, until);
        pipeline.expire(`rt:presence:${entry.userId}`, PRESENCE_TTL_SECONDS);
      }
      await pipeline.exec();
    });
  }

  async isConnected(userId: string): Promise<boolean> {
    try {
      const values = await this.redis.hvals(`rt:presence:${userId}`);
      const now = Date.now();
      return values.some((value) => Number(value) > now);
    } catch {
      return false;
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.safe(() =>
      this.redis.set(`rt:revoked:${sessionId}`, '1', 'EX', REVOKED_TTL_SECONDS),
    );
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(`rt:revoked:${sessionId}`)) === 1;
    } catch {
      return true;
    }
  }

  close(): Promise<void> {
    this.redis.disconnect();
    return Promise.resolve();
  }

  private async safe(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch {
      // stato tecnico al meglio: le letture negano nel dubbio
    }
  }
}
