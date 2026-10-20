import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Pool } from 'pg';

/** Cartella delle migrazioni SQL versionate. */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

/**
 * Applica in ordine le migrazioni SQL non ancora applicate, ognuna nella sua transazione.
 * Funzioni, trigger e ruoli sono SQL scritto a mano: Drizzle serve alle query, non alle
 * migrazioni. Restituisce i nomi dei file applicati.
 */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    // Una sola esecuzione alla volta, anche con più istanze in avvio
    await client.query('SELECT pg_advisory_lock(727001)');
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (row) => row.name,
      ),
    );
    const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const content = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(content);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migrazione ${file} non riuscita: ${(error as Error).message}`, {
          cause: error,
        });
      }
    }
    await client.query('SELECT pg_advisory_unlock(727001)');
    return applied;
  } finally {
    client.release();
  }
}
