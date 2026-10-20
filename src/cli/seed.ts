import 'reflect-metadata';
import { generateSecret, generateURI } from 'otplib';
import { Pool, PoolClient } from 'pg';
import { loadConfig } from '../infra/config/config';
import { CryptoService } from '../infra/crypto/crypto.service';

/**
 * `npm run db:seed`: dati fittizi di sviluppo (mai in produzione). Svuota le tabelle e crea
 * comuni, aziende e domini di fantasia (D42: nessuna società reale), un operatore con tutti i
 * ruoli e alcuni utenti approvati con il profilo completo, più uno in approvazione.
 */

const CITIES = [
  ['015146', 'Milano', 'MI', 'Lombardia', 45.4642, 9.19, 1371498],
  ['058091', 'Roma', 'RM', 'Lazio', 41.8933, 12.4829, 2748109],
  ['001272', 'Torino', 'TO', 'Piemonte', 45.0705, 7.6868, 841600],
  ['037006', 'Bologna', 'BO', 'Emilia-Romagna', 44.4938, 11.3426, 390734],
  ['048017', 'Firenze', 'FI', 'Toscana', 43.7696, 11.2558, 360930],
  ['063049', 'Napoli', 'NA', 'Campania', 40.8518, 14.2681, 913462],
] as const;

const COMPANIES = [
  { name: 'Modello Partners', domains: ['modellopartners.example', 'modellopartners-it.example'] },
  { name: 'Quadrante Advisory', domains: ['quadrante.example'] },
  { name: 'Sintesi Consulting', domains: ['sintesi-consulting.example'] },
  { name: 'Orizzonte Strategy', domains: ['orizzonte.example'] },
];

interface SeedUser {
  first: string;
  last: string;
  company: number;
  gender: 'woman' | 'man' | 'non_binary' | 'undisclosed';
  interestedIn: 'men' | 'women' | 'everyone';
  birth: string;
  city: string;
  openSpace: boolean;
  status: 'active' | 'pending_approval';
  bio: string;
}

const USERS: SeedUser[] = [
  {
    first: 'Luca',
    last: 'Conti',
    company: 0,
    gender: 'man',
    interestedIn: 'women',
    birth: '1993-04-12',
    city: '015146',
    openSpace: true,
    status: 'active',
    bio: 'Un Gantt anche per le vacanze.',
  },
  {
    first: 'Giulia',
    last: 'Ferri',
    company: 0,
    gender: 'woman',
    interestedIn: 'men',
    birth: '1994-09-30',
    city: '015146',
    openSpace: true,
    status: 'active',
    bio: 'Slide pulite e caffè forte.',
  },
  {
    first: 'Marco',
    last: 'Riva',
    company: 0,
    gender: 'man',
    interestedIn: 'women',
    birth: '1990-01-21',
    city: '015146',
    openSpace: false,
    status: 'active',
    bio: 'Trasferte il lunedì, aperitivo il giovedì.',
  },
  {
    first: 'Sara',
    last: 'Gallo',
    company: 1,
    gender: 'woman',
    interestedIn: 'men',
    birth: '1995-06-02',
    city: '015146',
    openSpace: false,
    status: 'active',
    bio: 'Kick-off dinner? Ci sto.',
  },
  {
    first: 'Paolo',
    last: 'Neri',
    company: 1,
    gender: 'man',
    interestedIn: 'women',
    birth: '1991-11-15',
    city: '058091',
    openSpace: false,
    status: 'active',
    bio: "Excel è una forma d'arte.",
  },
  {
    first: 'Elena',
    last: 'Bruno',
    company: 2,
    gender: 'woman',
    interestedIn: 'everyone',
    birth: '1992-03-08',
    city: '015146',
    openSpace: false,
    status: 'active',
    bio: "Walk and talk tra un SAL e l'altro.",
  },
  {
    first: 'Andrea',
    last: 'Costa',
    company: 2,
    gender: 'non_binary',
    interestedIn: 'everyone',
    birth: '1996-07-19',
    city: '037006',
    openSpace: false,
    status: 'active',
    bio: 'Roadmap chiara, weekend liberi.',
  },
  {
    first: 'Chiara',
    last: 'Fontana',
    company: 3,
    gender: 'woman',
    interestedIn: 'men',
    birth: '1997-12-01',
    city: '015146',
    openSpace: false,
    status: 'pending_approval',
    bio: 'Appena arrivata in consulenza.',
  },
];

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.nodeEnv === 'production') throw new Error('db:seed non è ammesso in produzione');
  const crypto = new CryptoService(config);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_DIRECT ?? config.databaseUrl,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await reset(client);
    await seedCities(client);
    const companyIds = await seedCompanies(client);
    const operator = await seedOperator(client, crypto);
    await seedUsers(client, crypto, companyIds, operator.id);
    await seedOffsite(client, operator.id);
    await client.query('COMMIT');
    process.stdout.write(
      [
        'Dati di sviluppo creati.',
        `Operatore: ${operator.email} (ruoli admin, moderator, support)`,
        `Segreto TOTP: ${operator.secret}`,
        `URI per l'app di autenticazione: ${operator.uri}`,
        'Codice TOTP corrente: node dist/cli/totp.js <segreto>',
        `Utenti: ${USERS.map((u) => `${u.first.toLowerCase()}.${u.last.toLowerCase()}@personale.example`).join(', ')}`,
        '',
      ].join('\n'),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function reset(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'
       and tablename not in ('schema_migrations', 'config')`,
  );
  await client.query(`TRUNCATE ${rows.map((row) => `"${row.tablename}"`).join(', ')} CASCADE`);
}

async function seedCities(client: PoolClient): Promise<void> {
  for (const [id, name, province, region, lat, lon, population] of CITIES) {
    await client.query(
      `insert into cities (id, name, province_code, region, lat, lon, population, search_name)
       values ($1, $2, $3, $4, $5, $6, $7, lower($2))`,
      [id, name, province, region, lat, lon, population],
    );
  }
}

async function seedCompanies(client: PoolClient): Promise<string[]> {
  const ids: string[] = [];
  for (const company of COMPANIES) {
    const { rows } = await client.query<{ id: string }>(
      'insert into companies (name) values ($1) returning id',
      [company.name],
    );
    ids.push(rows[0]!.id);
    for (const domain of company.domains) {
      await client.query('insert into company_domains (domain, company_id) values ($1, $2)', [
        domain,
        rows[0]!.id,
      ]);
    }
  }
  // Azienda dimostrativa per la revisione degli store (D42), separata dai reali
  const demo = await client.query<{ id: string }>(
    "insert into companies (name, is_demo) values ('Demo Consulenza', true) returning id",
  );
  await client.query(
    "insert into company_domains (domain, company_id) values ('demo-consulenza.example', $1)",
    [demo.rows[0]!.id],
  );
  return ids;
}

async function seedOperator(client: PoolClient, crypto: CryptoService) {
  const email = 'admin@backoffice.example';
  const secret = process.env.SEED_OPERATOR_TOTP_SECRET || generateSecret();
  const { rows } = await client.query<{ id: string }>(
    `insert into operators (email, name, roles, encrypted_totp_secret)
     values ($1, 'Amministratore di sviluppo', '{admin,moderator,support}', $2) returning id`,
    [email, crypto.encryptTotpSecret(secret)],
  );
  return {
    id: rows[0]!.id,
    email,
    secret,
    uri: generateURI({ issuer: 'Swipe & Slide backoffice', label: email, secret }),
  };
}

async function seedUsers(
  client: PoolClient,
  crypto: CryptoService,
  companyIds: string[],
  operatorId: string,
): Promise<void> {
  for (const [index, user] of USERS.entries()) {
    const personal = `${user.first.toLowerCase()}.${user.last.toLowerCase()}@personale.example`;
    const company = COMPANIES[user.company]!;
    const work = `${user.first.toLowerCase()}.${user.last.toLowerCase()}@${company.domains[0]}`;
    const personalHash = crypto.hash('email', personal);
    const { rows } = await client.query<{ id: string }>(
      `insert into users (company_id, status) values ($1, 'registering') returning id`,
      [companyIds[user.company]],
    );
    const userId = rows[0]!.id;
    await client.query(
      `insert into personal_identities (user_id, provider, subject, email, email_hash, email_verified_at)
       values ($1, 'email', $2, $3, $2, now())`,
      [userId, personalHash, personal],
    );
    await client.query(
      `insert into work_emails (user_id, company_id, domain, email, email_hash, status, verified_at, next_reverification_at)
       values ($1, $2, $3, $4, $5, 'active', now(), now() + interval '90 days')`,
      [userId, companyIds[user.company], company.domains[0], work, crypto.hash('email', work)],
    );
    for (const type of ['terms', 'p7_declaration', 'art9']) {
      await client.query(
        "insert into consents (user_id, type, text_version) values ($1, $2, 'seed')",
        [userId, type],
      );
    }
    await client.query(
      `insert into profiles (user_id, first_name, last_name, birth_date, gender, interested_in, bio, home_city_id,
                             age_min, age_max)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 22, 40)`,
      [
        userId,
        user.first,
        user.last,
        user.birth,
        user.gender,
        user.interestedIn,
        user.bio,
        user.city,
      ],
    );
    for (const position of [1, 2]) {
      await client.query(
        `insert into photos (user_id, storage_key, position, status, checked_at)
         values ($1, $2, $3, $4, now())`,
        [
          userId,
          `seed/${index}-${position}.jpg`,
          position,
          user.status === 'active' ? 'approved' : 'pending_approval',
        ],
      );
    }
    await client.query("select set_open_space($1, $2, 'registration', 'seed')", [
      userId,
      user.openSpace,
    ]);
    await client.query("update users set status = 'pending_approval' where id = $1", [userId]);
    await client.query(
      `insert into profile_reviews (user_id, attempt, due_at, outcome, decided_by, decided_at)
       values ($1, 1, now() + interval '24 hours', $2, $3, $4)`,
      [
        userId,
        user.status === 'active' ? 'approved' : 'pending',
        user.status === 'active' ? operatorId : null,
        user.status === 'active' ? new Date() : null,
      ],
    );
    if (user.status === 'active') {
      await client.query("update users set status = 'active' where id = $1", [userId]);
    }
  }
}

async function seedOffsite(client: PoolClient, operatorId: string): Promise<void> {
  await client.query(
    `insert into offsites (title, description, venue_name, venue_address, city_id, starts_at, ends_at,
                           capacity, status, created_by, published_at)
     values ('Offsite d''autunno', 'Una serata tra consulenti, senza slide.', 'Spazio Navigli',
             'Via di fantasia 1, Milano', '015146', now() + interval '20 days',
             now() + interval '20 days 4 hours', 120, 'published', $1, now())`,
    [operatorId],
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
