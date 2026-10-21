import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';

/**
 * Parametri numerici del sistema dalla tabella `config` (D89), con il valore di partenza delle
 * decisioni se la chiave manca. Letti nella transazione che li usa, mai da una cache: sono pochi
 * e decidono limiti dell'utente.
 */
@Injectable()
export class ParametersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async int(key: string, fallback: number, tx: Executor = this.db): Promise<number> {
    const result = await tx.execute<{ value: string | null }>(
      sql`select value #>> '{}' as value from config where key = ${key}`,
    );
    const parsed = Number.parseInt(result.rows[0]?.value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
}
