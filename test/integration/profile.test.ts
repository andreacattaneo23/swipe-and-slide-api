// Integrazione del profilo con PostgreSQL, MinIO e il ruolo `app_role` (D240): tassonomie,
// modifiche del profilo, foto caricate davvero con URL firmati, profilo nel dettaglio dal feed e
// trasferte. Casi RC-22, RC-62, RC-114, RC-126, RC-135, RC-136, RC-137, RC-142.
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import type { App } from 'supertest/types';
import { photoKeys } from '../../src/domain/photos/photos.service';
import { Factory } from '../support/factory';
import {
  bearer,
  CITY,
  completeProfile,
  jpegWithLocation,
  seedCities,
  signIn,
  testStorage,
} from '../support/profile-support';
import { createTestApp } from '../support/test-app';
import { TEST_DATABASE_URL, truncateAll } from '../support/test-db';

const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
const f = new Factory(pool);
let app: INestApplication<App>;

beforeAll(async () => {
  ({ app } = await createTestApp('app', undefined, { realEmail: true }));
});

beforeEach(async () => {
  await truncateAll(pool);
  await seedCities(pool);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const api = () => request(app.getHttpServer());

/** Formato della data di oggi in ora italiana, più `days` giorni. */
const day = (days: number) => {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
};

async function activeUser(options: Parameters<typeof completeProfile>[2] = {}) {
  const company = await f.company();
  const id = await f.user(company);
  await completeProfile(pool, id, options);
  const { token } = await signIn(app, id);
  return { id, company, token };
}

describe('Tassonomie', () => {
  it('restituisce le voci attive con ETag e risponde 304 se non sono cambiate', async () => {
    const { token } = await activeUser();
    const first = await api().get('/taxonomies').set(bearer(token)).expect(200);
    expect(first.body.lookingFor).toHaveLength(6);
    expect(first.body.interests).toHaveLength(45);
    expect(first.body.practiceAreas).toHaveLength(12);
    expect(first.body.profileQuestions).toHaveLength(13);
    expect(first.headers['cache-control']).toContain('public');
    await api()
      .get('/taxonomies')
      .set({ ...bearer(token), 'If-None-Match': first.headers.etag })
      .expect(304);
  });
});

describe('Profilo dell’utente stesso', () => {
  it('legge il profilo con ciò che manca e lo modifica per gruppo', async () => {
    const company = await f.company();
    const id = await f.user(company);
    const { token } = await signIn(app, id);
    const before = await api().get('/me/profile').set(bearer(token)).expect(200);
    expect(before.body.isComplete).toBe(false);
    expect(before.body.missing).toEqual(expect.arrayContaining(['photos', 'homeCity']));
    const after = await api()
      .patch('/me/profile')
      .set(bearer(token))
      .send({
        bio: 'Consulente con la valigia pronta.',
        lookingFor: 'pptx',
        practiceArea: 'strategy',
        homeCityId: CITY.rome,
        ageMin: 25,
        ageMax: 40,
        maxDistance: 'km100',
        readReceipts: true,
      })
      .expect(200);
    expect(after.body).toMatchObject({
      bio: 'Consulente con la valigia pronta.',
      lookingFor: 'pptx',
      practiceArea: 'strategy',
      homeCity: { id: CITY.rome, name: 'Roma' },
      preferences: { ageMin: 25, ageMax: 40, maxDistance: 'km100' },
      readReceipts: true,
    });
  });

  it('RC-142: la data di nascita non si cambia, né dall’API né con una scrittura del ruolo app', async () => {
    const { id, token } = await activeUser();
    await api()
      .patch('/me/profile')
      .set(bearer(token))
      .send({ birthDate: '1980-01-01' })
      .expect(400);
    const client = await pool.connect();
    try {
      await client.query('set role app_role');
      await expect(
        client.query("update profiles set birth_date = '1980-01-01' where user_id = $1", [id]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('reset role');
      client.release();
    }
  });

  it('rifiuta testi con parole offensive, età incoerenti e codici sconosciuti', async () => {
    const { token } = await activeUser();
    const rejected = await api()
      .patch('/me/profile')
      .set(bearer(token))
      .send({ bio: 'Sei uno stronzo' })
      .expect(422);
    expect(rejected.body.error.code).toBe('profile.text.rejected');
    await api()
      .patch('/me/profile')
      .set(bearer(token))
      .send({ ageMin: 50, ageMax: 30 })
      .expect(422);
    await api()
      .patch('/me/profile')
      .set(bearer(token))
      .send({ lookingFor: 'inventato' })
      .expect(400);
  });

  it('interessi fino a 5 e domande a tema fino a 3, sostituiti per intero', async () => {
    const { id, token } = await activeUser();
    const ok = await api()
      .put('/me/profile/interests')
      .set(bearer(token))
      .send({ interests: ['cooking', 'pivot', 'trains'] })
      .expect(200);
    expect(ok.body.interests).toEqual(['cooking', 'pivot', 'trains']);
    await api()
      .put('/me/profile/interests')
      .set(bearer(token))
      .send({ interests: ['cooking', 'pivot', 'trains', 'sea', 'yoga', 'padel'] })
      .expect(422);
    const answers = await api()
      .put('/me/profile/answers')
      .set(bearer(token))
      .send({ answers: [{ question: 'kpi', answer: 'Che il tempo voli.' }] })
      .expect(200);
    expect(answers.body.answers).toEqual([{ question: 'kpi', answer: 'Che il tempo voli.' }]);
    await api()
      .put('/me/profile/answers')
      .set(bearer(token))
      .send({
        answers: ['kpi', 'scope', 'suitcase', 'trip_vice'].map((question) => ({
          question,
          answer: 'Una risposta.',
        })),
      })
      .expect(422);
    // Ultima difesa: il trigger rifiuta il sesto interesse anche con una scrittura diretta
    await pool.query(
      "insert into user_interests (user_id, interest) select $1, code from interests where code not in ('cooking','pivot','trains') limit 2",
      [id],
    );
    await expect(
      pool.query("insert into user_interests (user_id, interest) values ($1, 'gym')", [id]),
    ).rejects.toMatchObject({ code: 'SSP01' });
  });

  it('limita i cambi della città base con la data da cui riprovare', async () => {
    const { token } = await activeUser({ city: CITY.milan });
    for (const city of [CITY.rome, CITY.naples, CITY.milan]) {
      await api().patch('/me/profile').set(bearer(token)).send({ homeCityId: city }).expect(200);
    }
    const limited = await api()
      .patch('/me/profile')
      .set(bearer(token))
      .send({ homeCityId: CITY.rome })
      .expect(429);
    expect(limited.body.error.code).toBe('profile.city.limit');
    expect(limited.body.error.date).toBeDefined();
    const profile = await api().get('/me/profile').set(bearer(token)).expect(200);
    expect(profile.body.homeCityChangeableAt).not.toBeNull();
  });

  it('modalità OOO: "Vai in OOO" e "Torna operativo" valgono subito (D81)', async () => {
    const { token } = await activeUser();
    const on = await api().patch('/me/profile').set(bearer(token)).send({ ooo: true }).expect(200);
    expect(on.body.oooSince).not.toBeNull();
    const off = await api()
      .patch('/me/profile')
      .set(bearer(token))
      .send({ ooo: false })
      .expect(200);
    expect(off.body.oooSince).toBeNull();
  });
});

describe('Foto (D46, D73, D143)', () => {
  it('RC-126: carica con URL firmato, toglie i metadati e lascia la foto in revisione', async () => {
    const { id, token } = await activeUser({ photos: 2 });
    const created = await api().post('/me/photos').set(bearer(token)).expect(201);
    expect(created.body.upload.method).toBe('PUT');
    expect(created.body.photo.position).toBe(3);
    const original = await jpegWithLocation();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const put = await fetch(created.body.upload.url as string, { method: 'PUT', body: original });
    expect(put.ok).toBe(true);
    const confirmed = await api()
      .post(`/me/photos/${created.body.photo.id}/confirm`)
      .set(bearer(token))
      .expect(200);
    // Senza Cloud Vision nessuna approvazione automatica: revisione del team (D240)
    expect(confirmed.body.status).toBe('pending_approval');
    const { rows } = await pool.query<{ storage_key: string }>(
      'select storage_key from photos where id = $1',
      [created.body.photo.id],
    );
    const keys = photoKeys(rows[0]!.storage_key);
    expect(await testStorage().get(keys.temp)).toBeNull();
    const stored = await testStorage().get(keys.large);
    const meta = await sharp(stored!).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    // La foto in revisione non conta per la completezza e non la vede nessuno
    await pool.query('delete from photos where user_id = $1 and position = 2', [id]);
    const own = await api().get('/me/profile').set(bearer(token)).expect(200);
    expect(own.body.isComplete).toBe(false);
    await completeProfile(pool, id, { photos: 0 });
    await pool.query(
      "insert into photos (user_id, storage_key, position, status) values ($1, 'abc', 2, 'approved')",
      [id],
    );
    const viewer = await activeUser();
    const deck = await api().get(`/profiles/${id}`).set(bearer(viewer.token)).expect(200);
    expect(deck.body.photos).toHaveLength(2);
    const deckPhotos = deck.body.photos as { id: string }[];
    expect(deckPhotos.map((photo) => photo.id)).not.toContain(created.body.photo.id);
  });

  it('rifiuta un file che non è una foto e lo cancella', async () => {
    const { token } = await activeUser({ photos: 0 });
    const created = await api().post('/me/photos').set(bearer(token)).expect(201);
    await fetch(created.body.upload.url as string, { method: 'PUT', body: 'non sono una foto' });
    const response = await api()
      .post(`/me/photos/${created.body.photo.id}/confirm`)
      .set(bearer(token))
      .expect(400);
    expect(response.body.error.code).toBe('photos.invalid');
    expect(
      (await pool.query('select 1 from photos where id = $1', [created.body.photo.id])).rowCount,
    ).toBe(0);
  });

  it('riordina e cancella le foto una per una (D83)', async () => {
    const { token } = await activeUser({ photos: 3 });
    const list = await api().get('/me/photos').set(bearer(token)).expect(200);
    const ids = (list.body as { id: string }[]).map((photo) => photo.id);
    const reordered = await api()
      .patch('/me/photos/order')
      .set(bearer(token))
      .send({ photoIds: [ids[2], ids[0], ids[1]] })
      .expect(200);
    expect((reordered.body as { id: string }[]).map((photo) => photo.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);
    await api().delete(`/me/photos/${ids[0]}`).set(bearer(token)).expect(204);
    const after = await api().get('/me/photos').set(bearer(token)).expect(200);
    expect(after.body).toHaveLength(2);
  });
});

describe('Profilo nel dettaglio dal feed', () => {
  it('RC-22, RC-62, RC-114: nessun cognome, azienda, email, città base né data di nascita', async () => {
    const a = await activeUser();
    const b = await activeUser({ city: CITY.rome });
    await pool.query("update profiles set last_name = 'Ferri', bio = 'Ciao' where user_id = $1", [
      b.id,
    ]);
    const deck = await api().get(`/profiles/${b.id}`).set(bearer(a.token)).expect(200);
    const text = JSON.stringify(deck.body);
    expect(text).not.toContain('Ferri');
    expect(text).not.toContain('Roma');
    expect(text).not.toContain(b.company);
    expect(text).not.toMatch(/@|1992-01-01|interested|birth|lastName|company|homeCity/i);
    expect(deck.body).toMatchObject({ id: b.id, firstName: 'Persona', bio: 'Ciao' });
  });

  it('RC-60: senza visibilità reciproca il profilo è 404 come un identificativo inesistente', async () => {
    const company = await f.company();
    const a = await f.user(company);
    const b = await f.user(company);
    await completeProfile(pool, a);
    await completeProfile(pool, b);
    const { token } = await signIn(app, a);
    const colleague = await api().get(`/profiles/${b}`).set(bearer(token)).expect(404);
    const missing = await api()
      .get('/profiles/00000000-0000-4000-8000-000000000000')
      .set(bearer(token))
      .expect(404);
    expect(colleague.body).toEqual(missing.body);
  });

  it('RC-137: con il profilo incompleto o in OOO il profilo dal feed è 404', async () => {
    const a = await activeUser();
    const b = await activeUser();
    await api().get(`/profiles/${b.id}`).set(bearer(a.token)).expect(200);
    await pool.query('update profiles set ooo_since = now() where user_id = $1', [a.id]);
    await api().get(`/profiles/${b.id}`).set(bearer(a.token)).expect(404);
    await pool.query('update profiles set ooo_since = null where user_id = $1', [a.id]);
    await pool.query('delete from photos where user_id = $1 and position = 2', [b.id]);
    await api().get(`/profiles/${b.id}`).set(bearer(a.token)).expect(404);
  });

  it('RC-136: "Non binario" si vede solo da chi cerca "tutti"', async () => {
    const a = await activeUser({ interestedIn: 'women' });
    const c = await activeUser({ interestedIn: 'everyone' });
    const b = await activeUser({ gender: 'non_binary' });
    const fromA = await api().get(`/profiles/${b.id}`).set(bearer(a.token)).expect(200);
    expect(fromA.body.gender).toBeNull();
    const fromC = await api().get(`/profiles/${b.id}`).set(bearer(c.token)).expect(200);
    expect(fromC.body.gender).toBe('non_binary');
  });

  it('RC-135: trasferte solo nei 14 giorni prima, con la città mostrata, mai col calendario nascosto', async () => {
    const a = await activeUser();
    const b = await activeUser({ city: CITY.rome });
    await pool.query(
      `insert into trips (user_id, city_id, start_date, end_date)
       values ($1, $2, $3::date, $4::date), ($1, $5, $6::date, $7::date)`,
      [b.id, CITY.small, day(10), day(12), CITY.naples, day(40), day(42)],
    );
    const deck = await api().get(`/profiles/${b.id}`).set(bearer(a.token)).expect(200);
    expect(deck.body.trips).toEqual([{ cityName: 'Milano', startDate: day(10), endDate: day(12) }]);
    expect(JSON.stringify(deck.body)).not.toContain('Borgo Piccolo');
    await pool.query('update profiles set show_calendar = false where user_id = $1', [b.id]);
    const hidden = await api().get(`/profiles/${b.id}`).set(bearer(a.token)).expect(200);
    expect(hidden.body.trips).toEqual([]);
  });
});

describe('Trasferte (D57)', () => {
  it('crea, modifica e cancella con i limiti di durata, orizzonte, base e sovrapposizione', async () => {
    const { token } = await activeUser({ city: CITY.milan });
    const created = await api()
      .post('/me/trips')
      .set(bearer(token))
      .send({ cityId: CITY.rome, startDate: day(20), endDate: day(24) })
      .expect(201);
    expect(created.body).toMatchObject({
      city: { id: CITY.rome, name: 'Roma' },
      visibleFrom: day(6),
      visibleNow: false,
    });
    const errors: [Record<string, string>, string][] = [
      [{ cityId: CITY.naples, startDate: day(-1), endDate: day(2) }, 'trips.error.limits'],
      [{ cityId: CITY.naples, startDate: day(100), endDate: day(101) }, 'trips.error.limits'],
      [{ cityId: CITY.naples, startDate: day(1), endDate: day(60) }, 'trips.error.limits'],
      [{ cityId: CITY.milan, startDate: day(30), endDate: day(31) }, 'trips.error.baseCity'],
      [{ cityId: CITY.naples, startDate: day(22), endDate: day(26) }, 'trips.error.overlap'],
      [{ cityId: CITY.naples, startDate: day(5), endDate: day(3) }, 'trips.error.period'],
    ];
    for (const [body, code] of errors) {
      const response = await api().post('/me/trips').set(bearer(token)).send(body).expect(422);
      expect(response.body.error.code).toBe(code);
    }
    const moved = await api()
      .put(`/me/trips/${created.body.id}`)
      .set(bearer(token))
      .send({ cityId: CITY.naples, startDate: day(2), endDate: day(4) })
      .expect(200);
    expect(moved.body.visibleNow).toBe(true);
    await api().delete(`/me/trips/${created.body.id}`).set(bearer(token)).expect(204);
    const list = await api().get('/me/trips').set(bearer(token)).expect(200);
    expect(list.body).toMatchObject({ trips: [], max: 5, showCalendar: true });
  });

  it('al massimo 5 trasferte pianificate', async () => {
    const { token } = await activeUser({ city: CITY.milan });
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/me/trips')
        .set(bearer(token))
        .send({ cityId: CITY.rome, startDate: day(1 + i * 3), endDate: day(2 + i * 3) })
        .expect(201);
    }
    const sixth = await api()
      .post('/me/trips')
      .set(bearer(token))
      .send({ cityId: CITY.rome, startDate: day(40), endDate: day(41) })
      .expect(422);
    expect(sixth.body.error.code).toBe('trips.limit.reached');
  });
});
