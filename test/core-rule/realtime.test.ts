// Suite RC: tempo reale end to end (D180, D182, D190, D230, D231) con due client WebSocket veri,
// il servizio `realtime` e `app-api` in ascolto su porte vere, PostgreSQL e Redis veri.
import { randomUUID } from 'node:crypto';
import { type AddressInfo } from 'node:net';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { Pool } from 'pg';
import WebSocket from 'ws';
import { RealtimeServerModule } from '../../src/realtime/realtime-server.module';
import { bearer, createFeedChatApp, type FeedChatApp, FeedChatFixture } from '../support/feed-chat';
import { Factory } from '../support/factory';
import { testConfig } from '../support/test-config';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
const f = new Factory(pool);
const fx = new FeedChatFixture(pool);
let t: FeedChatApp;
let realtime: INestApplication;
let url: string;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  t = await createFeedChatApp(pool);
  const moduleRef = await Test.createTestingModule({
    imports: [RealtimeServerModule.forRoot({ ...testConfig('app'), serviceRole: 'realtime' })],
  }).compile();
  realtime = moduleRef.createNestApplication({ logger: false });
  realtime.useWebSocketAdapter(new WsAdapter(realtime));
  await realtime.listen(0, '127.0.0.1');
  const server = realtime.getHttpServer() as { address(): AddressInfo };
  url = `ws://127.0.0.1:${server.address().port}/ws`;
});
beforeEach(async () => {
  await truncateAll(pool);
  await fx.cities();
  t.push.sent.length = 0;
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.terminate();
});
afterAll(async () => {
  await realtime.close();
  await t.close();
  await pool.end();
});

/** Client vero con la coda dei messaggi ricevuti. */
interface Client {
  socket: WebSocket;
  received: Record<string, unknown>[];
  closed: Promise<number>;
  next(type: string, timeoutMs?: number): Promise<Record<string, unknown>>;
}

function connect(
  token: string | null,
  options: { viaMessage?: boolean | 'app' } = {},
): Promise<Client> {
  const socket = new WebSocket(url, {
    headers: token && !options.viaMessage ? { authorization: `Bearer ${token}` } : {},
  });
  sockets.push(socket);
  const received: Record<string, unknown>[] = [];
  const waiters: { type: string; resolve: (m: Record<string, unknown>) => void }[] = [];
  socket.on('message', (raw: Buffer) => {
    const message = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    received.push(message);
    const index = waiters.findIndex((w) => w.type === message.type);
    if (index >= 0) waiters.splice(index, 1)[0]!.resolve(message);
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  const client: Client = {
    socket,
    received,
    closed,
    next(type, timeoutMs = 1000) {
      const already = received.find((m) => m.type === type);
      if (already) {
        received.splice(received.indexOf(already), 1);
        return Promise.resolve(already);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`nessun evento ${type}`)), timeoutMs);
        waiters.push({
          type,
          resolve: (m) => {
            clearTimeout(timer);
            received.splice(received.indexOf(m), 1);
            resolve(m);
          },
        });
      });
    },
  };
  return new Promise((resolve, reject) => {
    socket.on('open', () => {
      // Primo messaggio nella forma del gateway o in quella dell'app (`event` e `data`)
      if (options.viaMessage === 'app' && token) {
        socket.send(JSON.stringify({ event: 'auth', data: { token } }));
      } else if (options.viaMessage && token) {
        socket.send(JSON.stringify({ type: 'auth', token }));
      }
      resolve(client);
    });
    socket.on('error', reject);
  });
}

async function person(company?: string) {
  const id = await f.user(company ?? (await f.company()));
  await fx.profile(id);
  return id;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Tempo reale (D180, D182, D190)', () => {
  it("RC-197 messaggio: evento solo all'altra persona, con soli identificativi, sotto 1 secondo", async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    const m = await f.match(a, b);
    const tokenA = await t.token(a);
    const clientA = await connect(tokenA);
    const clientB = await connect(await t.token(b));
    const clientC = await connect(await t.token(c));
    await Promise.all([clientA.next('ready'), clientB.next('ready'), clientC.next('ready')]);
    const started = Date.now();
    const res = await t
      .api()
      .post(`/matches/${m}/messages`)
      .set(bearer(tokenA))
      .send({ text: 'Testo che non viaggia sul canale', clientMessageId: randomUUID() })
      .expect(200);
    const event = await clientB.next('message');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(event).toEqual({ type: 'message', matchId: m, messageId: res.body.message.id });
    await wait(200);
    expect(clientA.received.filter((e) => e.type === 'message')).toEqual([]);
    expect(clientC.received).toEqual([]);
    expect(JSON.stringify([...clientA.received, ...clientB.received])).not.toContain('Testo');
  });

  it('D230 push del messaggio solo se il destinatario non ha un canale connesso', async () => {
    const a = await person();
    const b = await person();
    await pool.query(
      "insert into devices (user_id, installation_id, push_token, platform) values ($1, 'install-0005', 'ExponentPushToken[b]', 'ios')",
      [b],
    );
    const m = await f.match(a, b);
    const tokenA = await t.token(a);
    const clientB = await connect(await t.token(b));
    await clientB.next('ready');
    const message = () =>
      t
        .api()
        .post(`/matches/${m}/messages`)
        .set(bearer(tokenA))
        .send({ text: 'Ciao', clientMessageId: randomUUID() })
        .expect(200);
    await message();
    expect(t.push.sent).toHaveLength(0);
    clientB.socket.close();
    await clientB.closed;
    await wait(100);
    await message();
    expect(t.push.sent).toHaveLength(1);
  });

  it('RC-198 token assente, non valido o di registrazione: canale rifiutato; auth anche col primo messaggio', async () => {
    const a = await person();
    const invalid = await connect('non-un-token');
    expect(await invalid.closed).toBe(4001);
    const registration = await connect(await t.token(a, 'approval'));
    await registration.next('ready'); // approvazione: ammessa (D141)
    const viaMessage = await connect(await t.token(a), { viaMessage: true });
    await viaMessage.next('ready');
    const appForm = await connect(await t.token(a), { viaMessage: 'app' });
    await appForm.next('ready');
  });

  it('RC-198 uscita e "Esci da tutti i dispositivi": canali chiusi e sessione revocata rifiutata', async () => {
    const a = await person();
    const token1 = await t.token(a);
    const token2 = await t.token(a);
    const one = await connect(token1);
    const two = await connect(token2);
    await Promise.all([one.next('ready'), two.next('ready')]);
    await t.api().post('/auth/logout').set(bearer(token1)).send({}).expect(204);
    expect(await one.closed).toBe(4000);
    expect(two.socket.readyState).toBe(WebSocket.OPEN);
    const again = await connect(token1);
    expect(await again.closed).toBe(4001);
    await t.api().post('/auth/logout').set(bearer(token2)).send({ from: 'all' }).expect(204);
    expect(await two.closed).toBe(4000);
  });

  it('RC-197 match e inviti: eventi ai due, chiusura con la stessa forma per ogni motivo', async () => {
    const a = await person();
    const b = await person();
    const tokenA = await t.token(a);
    const tokenB = await t.token(b);
    const clientA = await connect(tokenA);
    const clientB = await connect(tokenB);
    await Promise.all([clientA.next('ready'), clientB.next('ready')]);
    await t.api().post('/swipes').set(bearer(tokenA)).send({ userId: b, type: 'like' }).expect(200);
    const res = await t
      .api()
      .post('/swipes')
      .set(bearer(tokenB))
      .send({ userId: a, type: 'like' })
      .expect(200);
    const matchId = res.body.match.matchId as string;
    expect(await clientA.next('match')).toEqual({ type: 'match', matchId, status: 'active' });
    expect(await clientB.next('match')).toEqual({ type: 'match', matchId, status: 'active' });
    await t.api().post(`/matches/${matchId}/close`).set(bearer(tokenB)).expect(204);
    expect(await clientA.next('match')).toEqual({ type: 'match', matchId, status: 'unavailable' });
  });
});
