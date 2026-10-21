import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { parseEnvelope, REALTIME_CHANNEL, type RealtimeEnvelope } from '../../core/realtime/events';

/**
 * Distribuzione degli eventi del tempo reale tra `app-api`, processi e istanze di `realtime`
 * (D182, D240): pubblicazione dopo il commit, consegna "al meglio", sempre su Redis (Upstash in
 * produzione, Homebrew in locale) con il canale `rt:events`.
 */
export abstract class RealtimeBus {
  abstract publish(envelope: RealtimeEnvelope): Promise<void>;
  /** Iscrizione agli eventi; restituisce la funzione che la toglie. */
  abstract subscribe(handler: (envelope: RealtimeEnvelope) => void): Promise<() => void>;
  abstract close(): Promise<void>;
}

export class RedisRealtimeBus extends RealtimeBus {
  private readonly logger = new Logger('RealtimeBus');
  private readonly publisher: Redis;
  private subscriber: Redis | null = null;
  private readonly handlers = new Set<(envelope: RealtimeEnvelope) => void>();

  constructor(private readonly url: string) {
    super();
    this.publisher = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    this.publisher.on('error', () => undefined);
  }

  async publish(envelope: RealtimeEnvelope): Promise<void> {
    try {
      await this.publisher.publish(REALTIME_CHANNEL, JSON.stringify(envelope));
    } catch {
      // Consegna al meglio: l'app rilegge alla riconnessione (architettura, "affidabilità")
      this.logger.warn('Evento del tempo reale non pubblicato');
    }
  }

  async subscribe(handler: (envelope: RealtimeEnvelope) => void): Promise<() => void> {
    if (!this.subscriber) {
      this.subscriber = new Redis(this.url, { maxRetriesPerRequest: null, lazyConnect: true });
      this.subscriber.on('error', () => undefined);
      this.subscriber.on('message', (_channel: string, raw: string) => {
        const envelope = parseEnvelope(raw);
        if (envelope) for (const item of this.handlers) item(envelope);
      });
      await this.subscriber.subscribe(REALTIME_CHANNEL);
    }
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.subscriber?.disconnect();
    this.publisher.disconnect();
    return Promise.resolve();
  }
}
