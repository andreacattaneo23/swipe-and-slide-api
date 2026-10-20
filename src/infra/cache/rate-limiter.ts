import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/config';

/**
 * Limiti di frequenza per IP e per chiave (D229): contatori con scadenza nella cache L2 su Redis;
 * se Redis non risponde si ricade su un contatore in memoria per istanza. I limiti di business
 * (codici OTP, Slide) restano in PostgreSQL.
 */
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiter.name);
  private readonly redis: Redis | null;
  private readonly memory = new Map<string, { count: number; resetAt: number }>();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.redis = config.redisUrl
      ? new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 1_000,
        })
      : null;
    this.redis?.on('error', () => undefined);
    this.redis
      ?.connect()
      .catch(() => this.logger.warn('Redis non raggiungibile: limiti in memoria'));
  }

  /** Conta un evento; restituisce `false` se il limite della finestra è superato. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const fullKey = `rl:${key}`;
    if (this.redis?.status === 'ready') {
      try {
        const count = await this.redis.incr(fullKey);
        if (count === 1) await this.redis.expire(fullKey, windowSeconds);
        return count <= limit;
      } catch {
        // si ricade sulla memoria
      }
    }
    const now = Date.now();
    const entry = this.memory.get(fullKey);
    if (!entry || entry.resetAt <= now) {
      this.memory.set(fullKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis && this.redis.status !== 'end') this.redis.disconnect();
    return Promise.resolve();
  }
}
