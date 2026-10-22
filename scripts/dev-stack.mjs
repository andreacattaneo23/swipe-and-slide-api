/**
 * Avvio locale completo con un comando (`npm run dev:stack`, fase 3 dell'integrazione, D240):
 *
 * 1. crea `.env` con segreti casuali se manca (solo in locale, mai nel repository);
 * 2. compila, applica le migrazioni, crea il bucket di MinIO e, con il database vuoto, esegue il
 *    seed con dati veri (aziende, operatore, utenti approvati con le foto su MinIO);
 * 3. avvia con `concurrently` la compilazione continua, `app-api` (3000), `admin-api` (3001),
 *    `realtime` (3002) e il programmatore dei processi pianificati (`jobs`);
 * 4. avvia anche il backoffice (3100) **solo se** c'è il suo repository accanto a questo
 *    (`../swipe-and-slide-backend`, D245; `BACKOFFICE_DIR` per un'altra cartella), altrimenti lo
 *    salta con un messaggio.
 *
 * Servizi richiesti, avviati con Homebrew: PostgreSQL 17 (socket in /tmp), Redis (6379), MinIO
 * (127.0.0.1:9100) e Mailpit (SMTP 1025, interfaccia 8025). Nessun servizio simulato.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
/** Repository del backoffice (D245): accanto a questo, o la cartella di `BACKOFFICE_DIR`. */
const backofficeDir = resolve(root, process.env.BACKOFFICE_DIR ?? '../swipe-and-slide-backend');
const secret = () => randomBytes(24).toString('hex');

/** `.env` locale di sviluppo: segreti casuali, servizi locali di Homebrew. */
function ensureEnv() {
  if (existsSync(envFile)) return;
  const lines = [
    '# Creato da npm run dev:stack: solo sviluppo locale, mai nel repository',
    'NODE_ENV=development',
    'DATABASE_URL=postgres:///swipe_slide_dev?host=/tmp',
    'REDIS_URL=redis://localhost:6379',
    `JWT_ACCESS_SIGNING_KEY=${secret()}`,
    `JWT_ADMIN_SIGNING_KEY=${secret()}`,
    `HMAC_SECRET=${secret()}`,
    `TOKEN_ENCRYPTION_KEY=${secret()}`,
    'EMAIL_TRANSPORT=smtp',
    'SMTP_HOST=127.0.0.1',
    'SMTP_PORT=1025',
    'EMAIL_FROM_NEUTRAL=codici@swipeandslide.local',
    'EMAIL_FROM_PROJECT=ciao@swipeandslide.local',
    'S3_ENDPOINT=http://127.0.0.1:9100',
    'S3_BUCKET=swipe-slide-dev',
    'S3_ACCESS_KEY_ID=minioadmin',
    'S3_SECRET_ACCESS_KEY=minioadmin',
    'KEY_CUSTODY=env',
    `MESSAGE_MASTER_KEY=${secret()}`,
    'CF_ACCESS_DISABLED=true',
    '',
  ];
  writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
  console.log('Creato .env con segreti casuali per lo sviluppo locale');
}

/** Variabili di `.env` (senza sovrascrivere quelle già impostate nel terminale). */
function loadEnv() {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`Non riuscito: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

async function databaseIsEmpty() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query('select count(*)::int as n from users');
    return rows[0].n === 0;
  } finally {
    await client.end();
  }
}

async function main() {
  ensureEnv();
  loadEnv();
  run('npx', ['tsc', '-p', 'tsconfig.build.json']);
  run('node', ['dist/cli/migrate.js']);
  run('node', ['dist/cli/storage-setup.js']);
  if (await databaseIsEmpty()) run('node', ['dist/cli/seed.js']);
  else console.log('Database già popolato: seed saltato (npm run db:seed per ricrearlo)');
  // Il backoffice è un repository a sé (D245): si avvia solo se c'è, con il suo package.json
  const withBackoffice = existsSync(join(backofficeDir, 'package.json'));
  if (withBackoffice && !existsSync(join(backofficeDir, 'node_modules'))) {
    run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: backofficeDir });
  }

  // Porte di base dell'architettura; si cambiano con le variabili se sono già occupate
  const port = {
    app: process.env.APP_PORT ?? '3000',
    admin: process.env.ADMIN_PORT ?? '3001',
    realtime: process.env.REALTIME_PORT ?? '3002',
    backoffice: process.env.BACKOFFICE_PORT ?? '3100',
  };
  const node = 'node --env-file-if-exists=.env --watch dist/main.js';
  const services = [
    ['tsc', 'npx tsc -p tsconfig.build.json -w --preserveWatchOutput'],
    ['app', `SERVICE_ROLE=app PORT=${port.app} DATABASE_ROLE=app_role ${node}`],
    ['admin', `SERVICE_ROLE=admin PORT=${port.admin} DATABASE_ROLE=backoffice_role ${node}`],
    ['realtime', `SERVICE_ROLE=realtime PORT=${port.realtime} DATABASE_ROLE=app_role ${node}`],
    ['jobs', 'DATABASE_ROLE=jobs_role node --env-file-if-exists=.env scripts/jobs-scheduler.mjs'],
  ];
  if (withBackoffice) {
    services.push([
      'backoffice',
      `cd ${JSON.stringify(backofficeDir)} && ADMIN_API_URL=http://localhost:${port.admin} ADMIN_PHOTOS_ORIGIN=http://127.0.0.1:9100 npx next dev -p ${port.backoffice}`,
    ]);
  } else {
    console.log(
      `Backoffice saltato: nessun repository in ${backofficeDir} (clona swipe-and-slide-backend accanto a questo o imposta BACKOFFICE_DIR)`,
    );
  }
  console.log(
    [
      `app-api http://localhost:${port.app}`,
      `admin-api http://localhost:${port.admin}`,
      `realtime ws://localhost:${port.realtime}/ws`,
      ...(withBackoffice ? [`backoffice http://localhost:${port.backoffice}`] : []),
      'Mailpit http://localhost:8025',
    ].join(' · '),
  );
  run('npx', [
    'concurrently',
    '-k',
    '-n',
    services.map(([name]) => name).join(','),
    '-c',
    'gray,blue,magenta,cyan,yellow,green'.split(',').slice(0, services.length).join(','),
    ...services.map(([, command]) => command),
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
