/**
 * Test di carico leggero del tempo reale (D190, D239), da lanciare in locale con i servizi veri
 * avviati: `app-api` (porta 3000), `realtime` (porta 3002), PostgreSQL e Redis.
 *
 *   node --env-file=.env scripts/realtime-load.mjs [--rounds 200] [--concurrency 4]
 *
 * Crea due utenti di prova con un match (nel database di `DATABASE_URL`, con l'utente
 * proprietario dello schema), apre due client WebSocket veri, manda i messaggi da A con l'API e
 * misura il tempo fino all'evento `message` sul canale di B. Alla fine cancella i dati creati e
 * stampa mediana, 95° percentile e massimo; esce con 1 se il 95° percentile supera 1 secondo.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { SignJWT } from 'jose';
import WebSocket from 'ws';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? Number(argv[index + 1]) : fallback;
};
const ROUNDS = option('rounds', 200);
const CONCURRENCY = option('concurrency', 4);
const API = process.env.LOAD_API_URL ?? 'http://localhost:3000';
const WS = process.env.LOAD_WS_URL ?? 'ws://localhost:3002/ws';
const key = new TextEncoder().encode(process.env.JWT_ACCESS_SIGNING_KEY ?? '');
if (!process.env.DATABASE_URL || key.length < 32) {
  console.error('Servono DATABASE_URL e JWT_ACCESS_SIGNING_KEY (usa --env-file=.env)');
  process.exit(2);
}
// Il database come proprietario dello schema: il ruolo dell'API non crea utenti attivi
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function createUser(client, companyId, domain, operatorId, cityId, n) {
  const { rows } = await client.query(
    "insert into users (company_id, status) values ($1, 'registering') returning id",
    [companyId],
  );
  const id = rows[0].id;
  await client.query(
    `insert into personal_identities (user_id, provider, subject, email, email_hash, email_verified_at)
     values ($1, 'email', $2, $3, $2, now())`,
    [id, `load-${id}`, `carico-${n}-${id}@personale.example`],
  );
  await client.query(
    `insert into work_emails (user_id, company_id, domain, email, email_hash, verified_at, next_reverification_at)
     values ($1, $2, $3, $4, $5, now(), now() + interval '90 days')`,
    [id, companyId, domain, `carico-${id}@${domain}`, `load-work-${id}`],
  );
  for (const type of ['terms', 'p7_declaration', 'art9']) {
    await client.query(
      "insert into consents (user_id, type, text_version) values ($1, $2, 'load')",
      [id, type],
    );
  }
  await client.query(
    `insert into profiles (user_id, first_name, birth_date, gender, interested_in, home_city_id)
     values ($1, 'Carico', '1990-01-01', 'woman', 'everyone', $2)`,
    [id, cityId],
  );
  await client.query("select set_open_space($1, false, 'registration', 'load')", [id]);
  await client.query("update users set status = 'pending_approval' where id = $1", [id]);
  await client.query(
    `insert into profile_reviews (user_id, attempt, due_at, outcome, decided_by, decided_at)
     values ($1, 1, now() + interval '1 day', 'approved', $2, now())`,
    [id, operatorId],
  );
  await client.query("update users set status = 'active' where id = $1", [id]);
  const session = await client.query(
    `insert into sessions (user_id, refresh_hash, scope, sign_in_method, expires_at)
     values ($1, $2, 'full', 'personal_email', now() + interval '1 hour') returning id`,
    [id, `load-${randomUUID()}`],
  );
  const token = await new SignJWT({ sid: session.rows[0].id, scope: 'full' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(id)
    .setIssuer('swipe-and-slide')
    .setAudience('app')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
  return { id, token };
}

async function setup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tag = randomUUID().slice(0, 8);
    const city = await client.query(
      'select id from cities where is_active order by population desc limit 1',
    );
    if (!city.rows[0]) throw new Error('Nessun comune nel database: esegui prima npm run db:seed');
    const operator = await client.query(
      `insert into operators (email, name, roles, encrypted_totp_secret)
       values ($1, 'Carico', '{moderator}', 'x') returning id`,
      [`carico-${tag}@backoffice.example`],
    );
    const users = [];
    const companies = [];
    for (const n of [1, 2]) {
      const domain = `carico${n}-${tag}.example`;
      const company = await client.query('insert into companies (name) values ($1) returning id', [
        `Carico ${n} ${tag}`,
      ]);
      companies.push(company.rows[0].id);
      await client.query('insert into company_domains (domain, company_id) values ($1, $2)', [
        domain,
        company.rows[0].id,
      ]);
      users.push(
        await createUser(
          client,
          company.rows[0].id,
          domain,
          operator.rows[0].id,
          city.rows[0].id,
          n,
        ),
      );
    }
    const [a, b] = users;
    const match = await client.query(
      'insert into matches (user_a_id, user_b_id) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid)) returning id',
      [a.id, b.id],
    );
    await client.query('COMMIT');
    return { a, b, matchId: match.rows[0].id, companies, operatorId: operator.rows[0].id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup(data) {
  for (const user of [data.a, data.b]) await pool.query('select delete_account($1)', [user.id]);
  await pool.query('delete from matches where id = $1', [data.matchId]);
  await pool.query('delete from companies where id = any($1::uuid[])', [data.companies]);
  await pool.query('delete from operators where id = $1', [data.operatorId]);
}

function open(token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS, { headers: { authorization: `Bearer ${token}` } });
    socket.on('message', (raw) => {
      if (JSON.parse(raw.toString()).type === 'ready') resolve(socket);
    });
    socket.on('error', reject);
    socket.on('close', (code) => reject(new Error(`canale chiuso: ${code}`)));
  });
}

const percentile = (values, p) =>
  values[Math.min(values.length - 1, Math.floor((p / 100) * values.length))];

async function main() {
  const data = await setup();
  // Il limite di frequenza dei messaggi (D231) si alza solo per la durata del test
  const limit = await pool.query("select value from config where key = 'chat.messages_per_minute'");
  await pool.query(`insert into config (key, value) values ('chat.messages_per_minute', '100000')
                    on conflict (key) do update set value = excluded.value`);
  const latencies = [];
  try {
    const receiver = await open(data.b.token);
    const sender = await open(data.a.token); // anche A connesso: due client veri
    const pending = new Map();
    // L'evento può arrivare prima della risposta HTTP: si tiene l'ora di arrivo
    const arrivals = new Map();
    receiver.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type !== 'message') return;
      const at = performance.now();
      const waiter = pending.get(event.messageId);
      if (waiter) waiter(at);
      else arrivals.set(event.messageId, at);
    });
    let sent = 0;
    async function worker() {
      while (sent < ROUNDS) {
        sent += 1;
        const started = performance.now();
        const response = await fetch(`${API}/matches/${data.matchId}/messages`, {
          method: 'POST',
          headers: { authorization: `Bearer ${data.a.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            text: `Messaggio di carico ${sent}`,
            clientMessageId: randomUUID(),
          }),
        });
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
        if (!response.ok) throw new Error(`invio non riuscito: ${response.status}`);
        const body = await response.json();
        const early = arrivals.get(body.message.id);
        arrivals.delete(body.message.id);
        const arrived =
          early ??
          (await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error('evento non arrivato entro 5 s')),
              5000,
            );
            pending.set(body.message.id, (at) => {
              clearTimeout(timer);
              resolve(at);
            });
          }));
        pending.delete(body.message.id);
        latencies.push(arrived - started);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    receiver.close();
    sender.close();
  } finally {
    if (limit.rows[0]) {
      await pool.query("update config set value = $1 where key = 'chat.messages_per_minute'", [
        JSON.stringify(limit.rows[0].value),
      ]);
    } else {
      await pool.query("delete from config where key = 'chat.messages_per_minute'");
    }
    await cleanup(data);
    await pool.end();
  }
  latencies.sort((x, y) => x - y);
  const result = {
    messages: latencies.length,
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
    maxMs: Math.round(latencies[latencies.length - 1]),
  };
  console.log(JSON.stringify(result));
  process.exit(result.p95Ms < 1000 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
