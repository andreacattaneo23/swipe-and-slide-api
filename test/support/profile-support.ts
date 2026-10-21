import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { SessionsService } from '../../src/app/auth/sessions.service';
import { photoKeys } from '../../src/domain/photos/photos.service';
import { S3ObjectStorage } from '../../src/infra/storage/s3-object-storage';
import { testConfig } from './test-config';

/** Comuni di prova: Milano, Roma e un comune piccolo che si mostra come Milano (D109). */
export const CITY = { milan: '015146', rome: '058091', small: '015999', naples: '063049' } as const;

export async function seedCities(pool: Pool): Promise<void> {
  await pool.query(`
    insert into cities (id, name, province_code, region, lat, lon, population, search_name)
    values ('015146', 'Milano', 'MI', 'Lombardia', 45.46, 9.19, 1371498, 'milano'),
           ('058091', 'Roma', 'RM', 'Lazio', 41.89, 12.48, 2748109, 'roma'),
           ('063049', 'Napoli', 'NA', 'Campania', 40.85, 14.27, 913704, 'napoli')
    on conflict (id) do nothing`);
  await pool.query(`
    insert into cities (id, name, province_code, region, lat, lon, population, search_name, display_city_id)
    values ('015999', 'Borgo Piccolo', 'MI', 'Lombardia', 45.5, 9.2, 800, 'borgo piccolo', '015146')
    on conflict (id) do nothing`);
}

let storage: S3ObjectStorage | null = null;
export const testStorage = (): S3ObjectStorage =>
  (storage ??= new S3ObjectStorage(testConfig().storage));

/** JPEG vero con i metadati EXIF di posizione, per verificare che il server li tolga (D46). */
export async function jpegWithLocation(): Promise<Buffer> {
  return sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 180, g: 88, b: 63 } },
  })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Telefono di prova', Model: 'Modello' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 27/1 0/1', GPSLongitudeRef: 'E' },
    })
    .toBuffer();
}

/**
 * Profilo completo (D51): città base e due foto approvate, con i file caricati davvero
 * sull'archivio (MinIO), così gli URL firmati puntano a oggetti esistenti.
 */
export async function completeProfile(
  pool: Pool,
  userId: string,
  options: { city?: string; gender?: string; interestedIn?: string; photos?: number } = {},
): Promise<void> {
  await pool.query(
    `update profiles set home_city_id = $2, gender = $3::gender, interested_in = $4::interested_in
      where user_id = $1`,
    [
      userId,
      options.city ?? CITY.milan,
      options.gender ?? 'woman',
      options.interestedIn ?? 'everyone',
    ],
  );
  const image = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 58, g: 36, b: 54 } },
  })
    .jpeg()
    .toBuffer();
  for (let position = 1; position <= (options.photos ?? 2); position++) {
    const key = randomBytes(16).toString('hex');
    await testStorage().put(photoKeys(key).large, image, 'image/jpeg');
    await testStorage().put(photoKeys(key).thumb, image, 'image/jpeg');
    await pool.query(
      `insert into photos (user_id, storage_key, position, status, checked_at)
       values ($1, $2, $3, 'approved', now())`,
      [userId, key, position],
    );
  }
}

/** Sessione vera dell'account, con l'ambito calcolato dallo stato, e il suo token di accesso. */
export async function signIn(
  app: INestApplication,
  userId: string,
): Promise<{ token: string; sessionId: string }> {
  const tokens = await app.get(SessionsService).create(userId, 'personal_email');
  const sessionId = tokens.refreshToken.split('.')[0]!;
  return { token: tokens.accessToken, sessionId };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
