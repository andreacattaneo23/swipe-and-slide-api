import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { authNonces } from '../../infra/database/schema';
import { CryptoService } from '../../infra/crypto/crypto.service';

export const NONCE_MINUTES = 5;

/**
 * Nonce emessi dal server (D236): casuali, a uso singolo, validi 5 minuti. L'app passa al
 * fornitore la sua impronta SHA-256 (Apple) o il valore (Google) e al backend il valore
 * originale; il backend lo confronta con il token e lo consuma.
 */
@Injectable()
export class NonceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  async issue(): Promise<{ nonce: string; expiresAt: Date }> {
    const nonce = this.crypto.randomToken(32);
    const [row] = await this.db
      .insert(authNonces)
      .values({
        nonceHash: this.crypto.hash('nonce', nonce),
        expiresAt: sql`now() + make_interval(mins => ${NONCE_MINUTES})`,
      })
      .returning({ expiresAt: authNonces.expiresAt });
    return { nonce, expiresAt: row!.expiresAt };
  }

  /** Consuma il nonce: `false` se sconosciuto, scaduto o già usato. */
  async consume(nonce: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(nonce)) return false;
    const used = await this.db
      .update(authNonces)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(authNonces.nonceHash, this.crypto.hash('nonce', nonce)),
          isNull(authNonces.consumedAt),
          gt(authNonces.expiresAt, sql`now()`),
        ),
      )
      .returning({ hash: authNonces.nonceHash });
    return used.length === 1;
  }
}
