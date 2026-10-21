import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../infra/config/config';

/** Scadenza breve dei lotti del feed (D229, D235). */
export const FEED_BATCH_SECONDS = 120;

/**
 * Lotti del feed nella cache L2 su Redis (D229, D235, D240): solo identificativi opachi dei
 * profili, già in ordine casuale pesato, con una scadenza breve; nessuna preferenza né criterio di
 * ricerca, così dalla cache non si deduce "chi ti interessa". La cache non decide mai la
 * visibilità: ogni identificativo si ricontrolla con `feed_candidates` (e quindi `can_interact`)
 * al momento dell'uso. Se Redis non risponde il lotto si ricalcola.
 */
@Injectable()
export class FeedBatchCache implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (!config.redisUrl) throw new Error('REDIS_URL mancante: la cache L2 usa Redis (D229)');
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      lazyConnect: true,
    });
    this.redis.on('error', () => undefined);
  }

  async take(key: string, count: number): Promise<string[]> {
    try {
      return (await this.redis.lpop(`feed:${key}`, count)) ?? [];
    } catch {
      return [];
    }
  }

  async store(key: string, ids: string[]): Promise<void> {
    try {
      if (ids.length === 0) {
        await this.redis.del(`feed:${key}`);
        return;
      }
      await this.redis
        .multi()
        .del(`feed:${key}`)
        .rpush(`feed:${key}`, ...ids)
        .expire(`feed:${key}`, FEED_BATCH_SECONDS)
        .exec();
    } catch {
      // la cache toglie solo lavoro: senza, il lotto si ricalcola
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
