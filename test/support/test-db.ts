import { Pool } from 'pg';
import { migrate } from '../../src/infra/database/migrator';

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

/** Svuota i dati tra un test e l'altro, lasciando migrazioni e configurazione. */
export async function truncateAll(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'
       and tablename not in ('schema_migrations', 'config')`,
  );
  await pool.query(`TRUNCATE ${rows.map((row) => `"${row.tablename}"`).join(', ')} CASCADE`);
}
