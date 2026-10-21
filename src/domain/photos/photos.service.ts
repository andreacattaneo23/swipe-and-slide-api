import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import {
  PHOTO_CHECKER,
  PhotoChecker,
  PhotoCheckResult,
} from '../../infra/photo-check/photo-checker';
import {
  OBJECT_STORAGE,
  ObjectStorage,
  SIGNED_URL_SECONDS,
  SignedUpload,
} from '../../infra/storage/object-storage';

/** Da 2 a 6 foto (D46); dimensione massima del file caricato [Proposta]. */
export const PHOTO_RULES = {
  max: 6,
  min: 2,
  maxUploadBytes: 12 * 1024 * 1024,
  largeSide: 1600,
  thumbSide: 480,
  staleUploadMinutes: 60,
} as const;

/** Formati accettati, riconosciuti dai byte e non dall'estensione (README, "Foto"). */
const FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

export type PhotoStatus =
  'uploading' | 'checking' | 'pending_approval' | 'approved' | 'under_review' | 'rejected';

export interface OwnPhoto {
  id: string;
  position: number;
  status: PhotoStatus;
  /** URL firmati di pochi minuti; assenti finché il file non è stato ricodificato. */
  url: string | null;
  thumbnailUrl: string | null;
}

type PhotoRow = {
  id: string;
  storage_key: string;
  position: number;
  status: PhotoStatus;
};

export const photoKeys = (storageKey: string) => ({
  temp: `tmp/${storageKey}`,
  large: `photos/${storageKey}/large.jpg`,
  thumb: `photos/${storageKey}/thumb.jpg`,
});

/**
 * Foto del profilo (D46, D73, D110, D143): caricamento con URL firmato in un'area temporanea,
 * ricodifica sul server con la rimozione di tutti i metadati (posizione compresa), variante
 * grande e miniatura, cancellazione dell'originale, controllo automatico e poi revisione del team.
 * Agli altri si mostrano solo le foto `approved`; nessun dato sul volto.
 */
@Injectable()
export class PhotosService {
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(PHOTO_CHECKER) private readonly checker: PhotoChecker,
  ) {}

  async listOwn(userId: string): Promise<OwnPhoto[]> {
    const rows = await this.db.execute<PhotoRow>(sql`
      select id, storage_key, position, status from photos
       where user_id = ${userId}::uuid and status <> 'uploading' order by position`);
    return Promise.all(rows.rows.map((row) => this.ownPhoto(row)));
  }

  /**
   * Nuova foto: riga `uploading` in una posizione libera e URL firmato per caricare il file
   * nell'area temporanea. I caricamenti abbandonati da più di un'ora si tolgono prima.
   */
  async createUpload(userId: string): Promise<{ photo: OwnPhoto; upload: SignedUpload }> {
    const storageKey = randomBytes(16).toString('hex');
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
      const stale = await tx.execute<{ storage_key: string }>(sql`
        delete from photos where user_id = ${userId}::uuid and status = 'uploading'
           and uploaded_at < now() - make_interval(mins => ${PHOTO_RULES.staleUploadMinutes})
        returning storage_key`);
      for (const old of stale.rows) await this.storage.delete(photoKeys(old.storage_key).temp);
      const used = await tx.execute<{ position: number; status: PhotoStatus; id: string }>(sql`
        select id, position, status from photos where user_id = ${userId}::uuid order by position`);
      if (used.rows.filter((photo) => photo.status !== 'rejected').length >= PHOTO_RULES.max) {
        throw ApiError.conflict('photos.max');
      }
      let position = [1, 2, 3, 4, 5, 6].find((n) => !used.rows.some((p) => p.position === n));
      if (position === undefined) {
        // Tutte le posizioni occupate anche da foto respinte: si toglie la respinta più vecchia
        const rejected = used.rows.find((photo) => photo.status === 'rejected');
        if (!rejected) throw ApiError.conflict('photos.max');
        await tx.execute(sql`delete from photos where id = ${rejected.id}::uuid`);
        position = rejected.position;
      }
      const inserted = await tx.execute<PhotoRow>(sql`
        insert into photos (user_id, storage_key, position, status)
        values (${userId}::uuid, ${storageKey}, ${position}, 'uploading')
        returning id, storage_key, position, status`);
      return inserted.rows[0]!;
    });
    const upload = await this.storage.signedUpload(
      photoKeys(storageKey).temp,
      SIGNED_URL_SECONDS.upload,
      PHOTO_RULES.maxUploadBytes,
    );
    return { photo: { ...(await this.ownPhoto(row)) }, upload };
  }

  /**
   * Conferma del caricamento: dimensione e tipo reale dai byte, ricodifica JPEG senza metadati,
   * varianti, cancellazione dell'originale e controllo automatico. Un controllo superato o non
   * disponibile lascia la foto `pending_approval`: la vede solo l'utente finché il team non la
   * approva (D141, D143, D240).
   */
  async confirm(userId: string, photoId: string): Promise<OwnPhoto> {
    const row = await this.ownRow(userId, photoId, this.db);
    if (row.status !== 'uploading') return this.ownPhoto(row);
    const keys = photoKeys(row.storage_key);
    const original = await this.storage.get(keys.temp);
    if (!original) throw ApiError.conflict('photos.notUploaded');
    if (original.length > PHOTO_RULES.maxUploadBytes) {
      await this.storage.delete(keys.temp);
      throw new ApiError(413, 'photos.tooLarge');
    }
    let large: Buffer;
    let thumb: Buffer;
    try {
      const meta = await sharp(original, { failOn: 'error' }).metadata();
      if (!meta.format || !FORMATS.has(meta.format)) throw new Error('formato');
      // `rotate()` applica l'orientamento e poi i metadati si perdono: sharp non li copia
      const base = sharp(original, { failOn: 'error' }).rotate();
      large = await base
        .clone()
        .resize(PHOTO_RULES.largeSide, PHOTO_RULES.largeSide, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      thumb = await base
        .clone()
        .resize(PHOTO_RULES.thumbSide, PHOTO_RULES.thumbSide, { fit: 'cover' })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
    } catch {
      await this.storage.delete(keys.temp);
      await this.db.execute(sql`delete from photos where id = ${photoId}::uuid`);
      throw ApiError.badRequest('photos.invalid');
    }
    await this.storage.put(keys.large, large, 'image/jpeg');
    await this.storage.put(keys.thumb, thumb, 'image/jpeg');
    await this.storage.delete(keys.temp);
    await this.db.execute(
      sql`update photos set status = 'checking' where id = ${photoId}::uuid and status = 'uploading'`,
    );
    return this.check(userId, photoId, large);
  }

  /** Controllo automatico sull'immagine già ricodificata (D73); rifatto dal processo orario. */
  async check(userId: string, photoId: string, image?: Buffer): Promise<OwnPhoto> {
    const row = await this.ownRow(userId, photoId, this.db);
    if (row.status !== 'checking') return this.ownPhoto(row);
    const keys = photoKeys(row.storage_key);
    const body = image ?? (await this.storage.get(keys.large));
    if (!body) return this.ownPhoto(row);
    let result: PhotoCheckResult;
    try {
      result = await this.checker.check(body);
    } catch {
      // Il servizio non risponde: la foto resta `checking` e la riprova il processo orario
      this.logger.warn('Controllo della foto non riuscito: nuovo tentativo più tardi');
      return this.ownPhoto(row);
    }
    if (result.outcome === 'passed' || result.outcome === 'manual') {
      await this.db.execute(sql`
        update photos set status = 'pending_approval', checked_at = now()
         where id = ${photoId}::uuid and status = 'checking'`);
    } else if (result.outcome === 'review') {
      await this.db.execute(sql`
        update photos set status = 'under_review', result_reason = ${result.reason}::photo_result_reason,
               checked_at = now()
         where id = ${photoId}::uuid and status = 'checking'`);
    } else if (result.outcome === 'rejected') {
      // Una foto respinta si elimina subito dall'archivio; la riga resta per informare l'utente
      await this.storage.delete(keys.large);
      await this.storage.delete(keys.thumb);
      await this.db.execute(sql`
        update photos set status = 'rejected', result_reason = ${result.reason}::photo_result_reason,
               checked_at = now()
         where id = ${photoId}::uuid and status = 'checking'`);
    }
    return this.ownPhoto(await this.ownRow(userId, photoId, this.db));
  }

  /** Nuovo ordine delle foto non respinte: la prima è la principale (D46). */
  async reorder(userId: string, ids: string[]): Promise<OwnPhoto[]> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
      const current = await tx.execute<{ id: string; status: PhotoStatus }>(sql`
        select id, status from photos where user_id = ${userId}::uuid order by position`);
      const visible = current.rows.filter(
        (p) => p.status !== 'rejected' && p.status !== 'uploading',
      );
      const same =
        ids.length === visible.length &&
        new Set(ids).size === ids.length &&
        ids.every((id) => visible.some((p) => p.id === id));
      if (!same) throw ApiError.badRequest('validation');
      const rest = current.rows.filter((p) => !ids.includes(p.id)).map((p) => p.id);
      await tx.execute(sql`set constraints photos_position_key deferred`);
      const order = [...ids, ...rest];
      for (const [index, id] of order.entries()) {
        await tx.execute(sql`update photos set position = ${index + 1} where id = ${id}::uuid`);
      }
    });
    return this.listOwn(userId);
  }

  /** Cancellazione di una foto (D83): subito dall'archivio e dal profilo. */
  async remove(userId: string, photoId: string): Promise<void> {
    const row = await this.ownRow(userId, photoId, this.db);
    await this.db.execute(sql`delete from photos where id = ${photoId}::uuid`);
    await this.deleteFiles([row.storage_key]);
  }

  /** File di tutte le foto indicate, per la cancellazione dell'account. */
  async deleteFiles(storageKeys: string[]): Promise<void> {
    for (const key of storageKeys) {
      const keys = photoKeys(key);
      await this.storage.delete(keys.temp);
      await this.storage.delete(keys.large);
      await this.storage.delete(keys.thumb);
    }
  }

  /**
   * Foto approvate di un altro utente, con URL firmati: da chiamare solo dopo il controllo della
   * regola (feed, profilo, match). Mai foto in attesa, in revisione o respinte (D143, RC-126).
   */
  async approvedFor(
    userId: string,
    tx: Executor = this.db,
  ): Promise<{ id: string; url: string; thumbnailUrl: string }[]> {
    const rows = await tx.execute<PhotoRow>(sql`
      select id, storage_key, position, status from photos
       where user_id = ${userId}::uuid and status = 'approved' order by position`);
    return Promise.all(
      rows.rows.map(async (row) => {
        const keys = photoKeys(row.storage_key);
        return {
          id: row.id,
          url: await this.storage.signedDownload(keys.large, SIGNED_URL_SECONDS.download),
          thumbnailUrl: await this.storage.signedDownload(keys.thumb, SIGNED_URL_SECONDS.download),
        };
      }),
    );
  }

  /**
   * Foto approvate di più utenti in una sola lettura (card del feed, elenchi), con URL firmati:
   * come `approvedFor`, da chiamare solo dopo il controllo della regola.
   */
  async approvedForMany(
    userIds: string[],
    tx: Executor = this.db,
  ): Promise<Map<string, { id: string; url: string; thumbnailUrl: string }[]>> {
    const result = new Map<string, { id: string; url: string; thumbnailUrl: string }[]>();
    if (userIds.length === 0) return result;
    const rows = await tx.execute<PhotoRow & { user_id: string }>(sql`
      select id, user_id, storage_key, position, status from photos
       where user_id = any(${`{${userIds.join(',')}}`}::uuid[]) and status = 'approved'
       order by user_id, position`);
    for (const row of rows.rows) {
      const keys = photoKeys(row.storage_key);
      const list = result.get(row.user_id) ?? [];
      list.push({
        id: row.id,
        url: await this.storage.signedDownload(keys.large, SIGNED_URL_SECONDS.download),
        thumbnailUrl: await this.storage.signedDownload(keys.thumb, SIGNED_URL_SECONDS.download),
      });
      result.set(row.user_id, list);
    }
    return result;
  }

  /**
   * URL firmati di una foto approvata (grande e miniatura), per feed, match e chat dopo il
   * controllo della regola; `null` se la foto non è approvata o non esiste (D143). Fonte unica
   * degli URL delle foto per gli altri moduli.
   */
  async signedUrls(
    photoId: string,
    tx: Executor = this.db,
  ): Promise<{ url: string; thumbnailUrl: string } | null> {
    const rows = await tx.execute<{ storage_key: string }>(sql`
      select storage_key from photos where id = ${photoId}::uuid and status = 'approved'`);
    const row = rows.rows[0];
    if (!row) return null;
    const keys = photoKeys(row.storage_key);
    return {
      url: await this.storage.signedDownload(keys.large, SIGNED_URL_SECONDS.download),
      thumbnailUrl: await this.storage.signedDownload(keys.thumb, SIGNED_URL_SECONDS.download),
    };
  }

  private async ownRow(userId: string, photoId: string, tx: Executor): Promise<PhotoRow> {
    const rows = await tx.execute<PhotoRow>(sql`
      select id, storage_key, position, status from photos
       where id = ${photoId}::uuid and user_id = ${userId}::uuid`);
    const row = rows.rows[0];
    if (!row) throw ApiError.notFound();
    return row;
  }

  private async ownPhoto(row: PhotoRow): Promise<OwnPhoto> {
    const keys = photoKeys(row.storage_key);
    const hasFiles = !['uploading', 'rejected'].includes(row.status);
    return {
      id: row.id,
      position: row.position,
      status: row.status,
      url: hasFiles
        ? await this.storage.signedDownload(keys.large, SIGNED_URL_SECONDS.download)
        : null,
      thumbnailUrl: hasFiles
        ? await this.storage.signedDownload(keys.thumb, SIGNED_URL_SECONDS.download)
        : null,
    };
  }
}
