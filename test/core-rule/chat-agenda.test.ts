// Suite RC: chat cifrata, conferme di lettura, inviti e Agenda dall'API (D59, D63, D64, D82,
// D107, D145–D149, D163, D183), con il ruolo `app_role`, i trigger e Redis vero.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Factory } from '../support/factory';
import {
  bearer,
  CITIES,
  createFeedChatApp,
  type FeedChatApp,
  FeedChatFixture,
  flush,
} from '../support/feed-chat';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 6 });
const f = new Factory(pool);
const fx = new FeedChatFixture(pool);
let t: FeedChatApp;

beforeAll(async () => {
  t = await createFeedChatApp(pool);
});
beforeEach(async () => {
  await truncateAll(pool);
  await fx.cities();
  t.push.sent.length = 0;
  t.events.length = 0;
});
afterAll(async () => {
  await t.close();
  await pool.end();
});

async function person(options: { company?: string; readReceipts?: boolean } = {}) {
  const id = await f.user(options.company ?? (await f.company()));
  await fx.profile(id, { readReceipts: options.readReceipts ?? false, firstName: 'Marco' });
  return id;
}

async function send(
  from: string,
  matchId: string,
  text: string,
  expected = 200,
  clientMessageId = randomUUID(),
) {
  return t
    .api()
    .post(`/matches/${matchId}/messages`)
    .set(bearer(await t.token(from)))
    .send({ text, clientMessageId })
    .expect(expected);
}

const inDays = (days: number) => {
  const date = new Date(Date.now() + days * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(date);
};

const invite = (overrides: Record<string, unknown> = {}) => ({
  type: 'sync_coffee',
  day: inDays(3),
  timeSlot: 'morning',
  cityId: CITIES.milano.id,
  ...overrides,
});

describe('Chat (D59, D63, D82, D183)', () => {
  it("RC-200 messaggi cifrati: nel database solo testo cifrato, l'API restituisce il testo", async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b);
    await send(a, m, 'Un pptx insieme? 📊');
    const { rows } = await pool.query<{ ciphertext: Buffer }>('select ciphertext from messages');
    expect(rows[0]!.ciphertext.toString('utf8')).not.toContain('pptx');
    const keys = await pool.query<{ encrypted_key: Buffer; key_version: string }>(
      'select * from chat_keys',
    );
    expect(keys.rows).toHaveLength(1);
    expect(keys.rows[0]!.key_version).toBe('env-v1');
    const list = await t
      .api()
      .get(`/matches/${m}/messages`)
      .set(bearer(await t.token(b)))
      .expect(200);
    expect(list.body.messages).toEqual([
      expect.objectContaining({ text: 'Un pptx insieme? 📊', mine: false }),
    ]);
  });

  it('D231 clientMessageId: un nuovo tentativo non crea un doppione; ripresa con after', async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b);
    const id = randomUUID();
    const first = await send(a, m, 'Ciao', 200, id);
    const again = await send(a, m, 'Ciao', 200, id);
    expect(again.body.message.id).toBe(first.body.message.id);
    const second = await send(b, m, 'Ciao a te');
    const after = await t
      .api()
      .get(`/matches/${m}/messages?after=${first.body.message.id}`)
      .set(bearer(await t.token(a)))
      .expect(200);
    expect((after.body.messages as { id: string }[]).map((x) => x.id)).toEqual([
      second.body.message.id,
    ]);
  });

  it("RC-197 evento `message` solo all'altra persona, con soli identificativi; push solo senza canale", async () => {
    const a = await person();
    const b = await person();
    await pool.query(
      "insert into devices (user_id, installation_id, push_token, platform) values ($1, 'install-0003', 'ExponentPushToken[b]', 'ios')",
      [b],
    );
    const m = await f.match(a, b);
    const sent = await send(a, m, 'Testo riservato');
    await flush();
    const mine = t.events.filter((e) => [a, b].includes(e.userId));
    const message = mine.filter((e) => e.event.type === 'message');
    expect(message).toEqual([
      { userId: b, event: { type: 'message', matchId: m, messageId: sent.body.message.id } },
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/riservato|Marco/);
    expect(t.push.sent.map((p) => p.body)).toEqual(['Hai un aggiornamento sul progetto']);
  });

  it('RC-115 anteprime solo se attivate; nessun invio durante la "Modalità in riunione"', async () => {
    const a = await person();
    const b = await person();
    await pool.query(
      "insert into devices (user_id, installation_id, push_token, platform) values ($1, 'install-0004', 'ExponentPushToken[b]', 'ios')",
      [b],
    );
    const token = await t.token(b);
    await t
      .api()
      .put('/me/notifications/preferences')
      .set(bearer(token))
      .send({ disabledTypes: [], previews: true, quietHours: [] })
      .expect(200);
    const m = await f.match(a, b);
    await send(a, m, 'Ci vediamo dopo lo standup?');
    expect(t.push.sent[0]!.body).toBe('Marco: Ci vediamo dopo lo standup?');
    t.push.sent.length = 0;
    await t
      .api()
      .put('/me/notifications/preferences')
      .set(bearer(token))
      .send({ disabledTypes: [], previews: false, quietHours: [{ start: '00:00', end: '23:59' }] })
      .expect(200);
    await send(a, m, 'Altro messaggio');
    expect(t.push.sent).toHaveLength(0);
    await t
      .api()
      .put('/me/notifications/preferences')
      .set(bearer(token))
      .send({ disabledTypes: ['new_message'], previews: false, quietHours: [] })
      .expect(200);
    await send(a, m, 'Terzo');
    expect(t.push.sent).toHaveLength(0);
  });

  it('D63 conferme di lettura solo se attive per entrambi', async () => {
    const a = await person({ readReceipts: true });
    const b = await person({ readReceipts: false });
    const m = await f.match(a, b);
    const sent = await send(a, m, 'Letto?');
    await t
      .api()
      .post(`/matches/${m}/reads`)
      .set(bearer(await t.token(b)))
      .send({ messageId: sent.body.message.id })
      .expect(204);
    const list = await t
      .api()
      .get(`/matches/${m}/messages`)
      .set(bearer(await t.token(a)))
      .expect(200);
    expect(list.body.messages[0]).not.toHaveProperty('readAt');
    await pool.query('update profiles set read_receipts = true where user_id = $1', [b]);
    const again = await t
      .api()
      .get(`/matches/${m}/messages`)
      .set(bearer(await t.token(a)))
      .expect(200);
    expect(again.body.messages[0].readAt).toEqual(expect.any(String));
  });

  it('RC-106 e D82 conversazione sospesa: lettura consentita, invio con match.frozen; match chiuso 404', async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b, { withMessageFrom: a });
    await pool.query("update users set status = 'suspended' where id = $1", [b]);
    const frozen = await send(a, m, 'Ci sei?', 409);
    expect(frozen.body.error.code).toBe('match.frozen');
    await t
      .api()
      .get(`/matches/${m}/messages`)
      .set(bearer(await t.token(a)))
      .expect(200);
    await pool.query("update users set status = 'active' where id = $1", [b]);
    await t
      .api()
      .post(`/matches/${m}/close`)
      .set(bearer(await t.token(b)))
      .expect(204);
    const closed = await send(a, m, 'Ci sei?', 404);
    expect(closed.body.error.code).toBe('not_found');
  });

  it('RC-92 chat che resta tra colleghi: i messaggi si scambiano nei due sensi', async () => {
    const x = await f.company();
    const a = await person();
    const b = await person({ company: x });
    const m = await f.match(a, b, { withMessageFrom: b });
    await f.changeCompany(a, x);
    await send(a, m, 'Ora siamo colleghi della stessa azienda');
    await send(b, m, 'Già');
  });

  it('D63 solo testo: caratteri di controllo tolti, oltre 1.000 caratteri rifiutato', async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b);
    const res = await send(a, m, 'Ciao\u0007​ a‮ te');
    expect(res.body.message.text).toBe('Ciao a te');
    await send(a, m, 'x'.repeat(1001), 400);
  });
});

describe('Inviti a calendario (D64, D146, D147, D163)', () => {
  it("RC-170 una sola proposta in sospeso per match, dalla chat e dall'Agenda", async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b, { withMessageFrom: a });
    await f.message(m, b);
    const token = await t.token(a);
    const created = await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(token))
      .send(invite({ venue: 'Bar Centrale', time: '10:30' }))
      .expect(200);
    expect(created.body).toMatchObject({
      status: 'pending',
      slotState: 'awaiting_reply',
      venue: 'Bar Centrale',
      time: '10:30',
      city: { name: 'Milano' },
    });
    const second = await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(token))
      .send(invite())
      .expect(409);
    expect(second.body.error.code).toBe('chat.meeting.pending');
    await t
      .api()
      .post('/agenda/meetings')
      .set(bearer(token))
      .send({ matchId: m, ...invite() })
      .expect(409);
    // Il luogo è cifrato nel database (D183)
    const { rows } = await pool.query<{ venue: Buffer }>('select venue from invites');
    expect(rows[0]!.venue.toString('utf8')).not.toContain('Centrale');
  });

  it("RC-170 nuovo meeting dall'Agenda solo con un messaggio di ognuna delle due persone (D148)", async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b, { withMessageFrom: a });
    const token = await t.token(a);
    const people = await t.api().get('/agenda/people').set(bearer(token)).expect(200);
    expect(people.body).toEqual([]);
    await t
      .api()
      .post('/agenda/meetings')
      .set(bearer(token))
      .send({ matchId: m, ...invite() })
      .expect(409);
    await f.message(m, b);
    const ok = await t.api().get('/agenda/people').set(bearer(token)).expect(200);
    expect(ok.body).toEqual([expect.objectContaining({ matchId: m, hasPendingInvite: false })]);
    await t
      .api()
      .post('/agenda/meetings')
      .set(bearer(token))
      .send({ matchId: m, ...invite() })
      .expect(200);
  });

  it('D64 risposte: "Propongo un\'altra data" sostituisce l\'invito; validazioni di data, fascia e città', async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b, { withMessageFrom: a });
    const tokenA = await t.token(a);
    const tokenB = await t.token(b);
    await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(tokenA))
      .send(invite({ day: inDays(0) }))
      .expect(400);
    await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(tokenA))
      .send(invite({ day: inDays(120) }))
      .expect(400);
    await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(tokenA))
      .send(invite({ time: '14:00' }))
      .expect(400);
    const created = await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(tokenA))
      .send(invite())
      .expect(200);
    await t
      .api()
      .post(`/matches/${m}/invites/${created.body.id}/response`)
      .set(bearer(tokenA))
      .send({ answer: 'accept' })
      .expect(409);
    const counter = await t
      .api()
      .post(`/matches/${m}/invites/${created.body.id}/response`)
      .set(bearer(tokenB))
      .send({ answer: 'reschedule', proposal: invite({ day: inDays(5), timeSlot: 'evening' }) })
      .expect(200);
    expect(counter.body).toMatchObject({
      slotState: 'to_reschedule',
      replacesId: created.body.id,
      proposedByMe: true,
    });
    const accepted = await t
      .api()
      .post(`/matches/${m}/invites/${counter.body.id}/response`)
      .set(bearer(tokenA))
      .send({ answer: 'accept' })
      .expect(200);
    expect(accepted.body.slotState).toBe('confirmed');
    const list = await t.api().get(`/matches/${m}/invites`).set(bearer(tokenA)).expect(200);
    expect((list.body as { status: string }[]).map((i) => i.status)).toEqual([
      'replaced',
      'accepted',
    ]);
  });

  it('RC-131 un invito da solo non avvia la chat: il match si revoca tra nuovi colleghi', async () => {
    const x = await f.company();
    const a = await person();
    const b = await person({ company: x });
    const m = await f.match(a, b);
    await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(await t.token(a)))
      .send(invite())
      .expect(200);
    await f.changeCompany(a, x);
    const { rows } = await pool.query('select status, close_reason from matches where id = $1', [
      m,
    ]);
    expect(rows[0]).toEqual({ status: 'closed', close_reason: 'colleagues' });
  });

  it('D64 suggerimenti dalle trasferte in comune; mai con il calendario nascosto (D109)', async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b, { withMessageFrom: a });
    await fx.trip(a, 'roma', 4, 6);
    await fx.trip(b, 'roma', 5, 8);
    const token = await t.token(a);
    const res = await t
      .api()
      .get(`/matches/${m}/invites/suggestions`)
      .set(bearer(token))
      .expect(200);
    expect(res.body[0]).toEqual({ day: inDays(5), city: { id: CITIES.roma.id, name: 'Roma' } });
    expect(res.body).toHaveLength(2);
    await pool.query('update profiles set show_calendar = false where user_id = $1', [b]);
    const hidden = await t
      .api()
      .get(`/matches/${m}/invites/suggestions`)
      .set(bearer(token))
      .expect(200);
    expect(hidden.body).toEqual([]);
  });
});

describe('Agenda (D145–D149)', () => {
  it('RC-169 solo i meeting dei match attivi; chiusura e blocco li tolgono; sospesa resta neutra', async () => {
    const a = await person();
    const b = await person();
    const c = await person();
    const d = await person();
    const mb = await f.match(a, b, { withMessageFrom: a });
    const mc = await f.match(a, c, { withMessageFrom: a });
    const md = await f.match(a, d, { withMessageFrom: a });
    const token = await t.token(a);
    for (const m of [mb, mc, md]) {
      await t.api().post(`/matches/${m}/invites`).set(bearer(token)).send(invite()).expect(200);
    }
    const range = `/agenda?from=${inDays(0)}&to=${inDays(10)}`;
    expect((await t.api().get(range).set(bearer(token)).expect(200)).body.meetings).toHaveLength(3);
    await t
      .api()
      .post(`/matches/${mb}/close`)
      .set(bearer(await t.token(b)))
      .expect(204);
    await pool.query(
      "update matches set status = 'closed', close_reason = 'blocked', closed_at = now() where id = $1",
      [mc],
    );
    await pool.query("update users set status = 'suspended' where id = $1", [d]);
    const agenda = await t.api().get(range).set(bearer(token)).expect(200);
    expect(agenda.body.meetings).toHaveLength(1);
    expect(agenda.body.meetings[0]).toMatchObject({ matchId: md, paused: true });
    expect(agenda.body.meetings[0]).not.toHaveProperty('person');
    const other = await t
      .api()
      .get(range)
      .set(bearer(await t.token(b)))
      .expect(200);
    expect(other.body.meetings).toEqual([]);
  });

  it('RC-171 trasferte solo proprie come fasce, con il nome reale; offsite come promemoria', async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b, { withMessageFrom: a });
    await fx.trip(a, 'pero', 2, 4);
    await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(await t.token(a)))
      .send(invite())
      .expect(200);
    const offsite = await fx.offsite({ endsInHours: 30 });
    await pool.query('insert into offsite_attendees (offsite_id, user_id) values ($1, $2)', [
      offsite,
      a,
    ]);
    const range = `/agenda?from=${inDays(0)}&to=${inDays(10)}`;
    const mine = await t
      .api()
      .get(range)
      .set(bearer(await t.token(a)))
      .expect(200);
    expect(mine.body.trips).toEqual([expect.objectContaining({ city: 'Pero' })]);
    expect(mine.body.offsites).toEqual([expect.objectContaining({ id: offsite })]);
    const theirs = await t
      .api()
      .get(range)
      .set(bearer(await t.token(b)))
      .expect(200);
    expect(theirs.body.trips).toEqual([]);
    expect(JSON.stringify(theirs.body)).not.toContain('Pero');
    expect(theirs.body.meetings[0].person).toMatchObject({ firstName: 'Marco' });
  });

  it("D145 punto della scheda Agenda: proposta dell'altra persona non ancora vista, senza numeri", async () => {
    const a = await person();
    const b = await person();
    const m = await f.match(a, b, { withMessageFrom: a });
    await t
      .api()
      .post(`/matches/${m}/invites`)
      .set(bearer(await t.token(a)))
      .send(invite())
      .expect(200);
    const tokenB = await t.token(b);
    expect((await t.api().get('/tabs').set(bearer(tokenB)).expect(200)).body).toMatchObject({
      agendaDot: true,
      unreadMessages: 1,
    });
    await t.api().get(`/matches/${m}/invites`).set(bearer(tokenB)).expect(200);
    expect((await t.api().get('/tabs').set(bearer(tokenB)).expect(200)).body.agendaDot).toBe(false);
  });
});
