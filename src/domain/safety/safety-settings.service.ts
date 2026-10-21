import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { configTable } from '../../infra/database/schema-safety';

/** Durata della cache L1 dei parametri (D229): dati quasi statici, per istanza. */
const TTL_MS = 30_000;

/**
 * Parametri di sicurezza, moderazione e amministrazione letti da `config` (tempi, soglie, limiti),
 * con i valori confermati dalle decisioni come riserva. Cambiarli resta una decisione di prodotto.
 */
@Injectable()
export class SafetySettings {
  private cache: { values: Map<string, unknown>; at: number } | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async int(key: string, fallback: number): Promise<number> {
    const value = (await this.values()).get(key);
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }

  async list(key: string): Promise<string[]> {
    const value = (await this.values()).get(key);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  /** Dopo una modifica dal backoffice la cache dell'istanza si svuota subito. */
  invalidate(): void {
    this.cache = null;
  }

  private async values(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.values;
    const rows = await this.db.select().from(configTable);
    const values = new Map(rows.map((row) => [row.key, row.value]));
    this.cache = { values, at: Date.now() };
    return values;
  }

  /** Lettura diretta di alcune chiavi, senza cache (configurazione del backoffice). */
  async raw(keys: string[]): Promise<Map<string, unknown>> {
    const rows = await this.db.select().from(configTable).where(inArray(configTable.key, keys));
    return new Map(rows.map((row) => [row.key, row.value]));
  }
}
