import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { migrate } from '../../src/infra/database/migrator';

// Credenziali dei servizi locali (MinIO) e database dei test solo nel `.env` locale (D240)
if (existsSync('.env')) process.loadEnvFile('.env');

/** Database dei test: `TEST_DATABASE_URL`, di base `swipe_slide_test` sul socket locale. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres:///swipe_slide_test?host=/tmp';

/** Schema ricreato da zero e migrazioni applicate, come in produzione. */
export async function resetDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}

/** Svuota i dati tra un test e l'altro, lasciando migrazioni, configurazione e tassonomie. */
export async function truncateAll(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'
       and tablename not in ('schema_migrations', 'config', 'looking_for_options',
                             'interests', 'practice_areas', 'profile_questions')`,
  );
  // `config` resta: senza CASCADE su `operators` (`config.updated_by`), che si svuota a parte
  await pool.query('update config set updated_by = null');
  await pool.query(
    `TRUNCATE ${rows
      .filter((row) => row.tablename !== 'operators')
      .map((row) => `"${row.tablename}"`)
      .join(', ')}`,
  );
  await pool.query('delete from operators');
}
