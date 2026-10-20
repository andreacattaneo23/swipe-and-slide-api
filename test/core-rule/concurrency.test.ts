// Suite RC: operazioni in parallelo (architettura, "Concorrenza"). Due connessioni reali: la
// seconda transazione aspetta il blocco della prima e poi ne vede l'esito.
import { Pool, type PoolClient } from 'pg';
import { Factory } from '../support/factory';
import { Rule, sqlState } from '../support/rule';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
const f = new Factory(pool);
const rule = new Rule(pool);

beforeEach(() => truncateAll(pool));
afterAll(() => pool.end());

/** Attende che una connessione sia ferma su un blocco, così l'ordine è certo. */
async function waitUntilBlocked(client: PoolClient): Promise<void> {
  // Il pid si legge dalla connessione: una query sullo stesso client resterebbe in fila
  const pid = (client as unknown as { processID: number }).processID;
  for (let i = 0; i < 100; i++) {
    const state = await pool.query<{ waiting: boolean }>(
      "select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = $1",
      [pid],
    );
    if (state.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('La seconda transazione non si è messa in attesa');
}

async function begin(): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query('BEGIN');
  return client;
}

describe('Concorrenza', () => {
  it("RC-19 like in parallelo al cambio azienda dell'altra persona: nessun like tra colleghi", async () => {
    const x = await f.company();
    const y = await f.company();
    const a = await f.user(x);
    const b = await f.user(y);
    const change = await begin();
    await f.changeCompany(b, x, { db: change });
    const liker = await begin();
    const likeState = sqlState(() => f.like(a, b, liker));
    // Il like aspetta il blocco della riga di B, poi vede l'azienda nuova
    await waitUntilBlocked(liker);
    await change.query('COMMIT');
    expect(await likeState).toBe('SSC01');
    await liker.query('ROLLBACK');
    change.release();
    liker.release();
    expect(await rule.likeExists(a, b)).toBe(false);
  });

  it('RC-94 primo messaggio e cambio azienda, nei due ordini', async () => {
    const x = await f.company();
    const y = await f.company();
    // Messaggio primo: la chat è avviata e il match resta
    const a1 = await f.user(x);
    const b1 = await f.user(y);
    const m1 = await f.match(a1, b1);
    await f.message(m1, a1);
    await f.changeCompany(b1, x);
    expect((await rule.matchStatus(m1)).status).toBe('active');
    // Cambio primo, con il messaggio in attesa del blocco: match revocato, messaggio rifiutato
    const a2 = await f.user(x);
    const b2 = await f.user(y);
    const m2 = await f.match(a2, b2);
    const change = await begin();
    await f.changeCompany(b2, x, { db: change });
    const writer = await begin();
    const message = sqlState(() => f.message(m2, a2, writer));
    await waitUntilBlocked(writer);
    await change.query('COMMIT');
    expect(await message).toBe('SSC01');
    await writer.query('ROLLBACK');
    change.release();
    writer.release();
    expect(await rule.matchStatus(m2)).toEqual({ status: 'closed', close_reason: 'colleagues' });
  });

  it("RC-155 B spegne l'Open space mentre A mette il like che crea il match, nei due ordini", async () => {
    const x = await f.company();
    // Spegnimento primo: il like aspetta e poi è rifiutato dal trigger
    const a = await f.user(x, { openSpace: true });
    const b = await f.user(x, { openSpace: true });
    const off = await begin();
    await off.query("select set_open_space($1, false, 'user', null)", [b]);
    const liker = await begin();
    const like = sqlState(() => f.like(a, b, liker));
    await waitUntilBlocked(liker);
    await off.query('COMMIT');
    expect(await like).toBe('SSC01');
    await liker.query('ROLLBACK');
    off.release();
    liker.release();
    // Like (e match) primo: lo spegnimento, che aspettava, revoca il match senza messaggi
    const c = await f.user(x, { openSpace: true });
    const d = await f.user(x, { openSpace: true });
    const creator = await begin();
    await f.like(c, d, creator);
    const [first, second] = c < d ? [c, d] : [d, c];
    const created = await creator.query<{ id: string }>(
      'insert into matches (user_a_id, user_b_id) values ($1, $2) returning id',
      [first, second],
    );
    const switcher = await pool.connect();
    const switchOff = switcher.query("select set_open_space($1, false, 'user', null)", [d]);
    await waitUntilBlocked(switcher);
    await creator.query('COMMIT');
    await switchOff;
    creator.release();
    switcher.release();
    expect(await rule.matchStatus(created.rows[0]!.id)).toEqual({
      status: 'closed',
      close_reason: 'colleagues',
    });
    expect(await rule.likeExists(c, d)).toBe(false);
  });
});
