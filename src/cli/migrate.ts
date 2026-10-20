import { Pool } from 'pg';
import { migrate } from '../infra/database/migrator';

/** `npm run db:migrate`: applica le migrazioni SQL con la connessione diretta (non il pooler). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Variabile d'ambiente mancante: DATABASE_URL_DIRECT o DATABASE_URL");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const applied = await migrate(pool);
    process.stdout.write(
      applied.length ? `Applicate: ${applied.join(', ')}\n` : 'Nessuna migrazione da applicare\n',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
