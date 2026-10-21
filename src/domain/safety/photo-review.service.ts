import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { photos, profiles, users } from '../../infra/database/schema';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { OBJECT_STORAGE, ObjectStorage } from '../../infra/storage/object-storage';
import { photoKeys } from '../photos/photos.service';
import { OperatorAction } from '../companies/companies.service';

/** URL firmati delle foto: pochi minuti, mai salvati. */
const PHOTO_SECONDS = 5 * 60;
/** Scadenza della coda "Foto nuove", come i profili (D197). */
const DUE_HOURS = 24;

export interface NewPhotoEntry {
  id: string;
  userId: string;
  firstName: string | null;
  position: number;
  uploadedAt: Date;
  /** Arrivo nella coda (nella forma del backoffice). */
  submittedAt: Date;
  dueAt: Date;
  minutesLeft: number;
  url: string;
  photo: { id: string; position: number; status: string; url: string };
}

/**
 * Foto nuove dopo l'approvazione (D143) e foto segnalate dal controllo automatico (D73): una
 * persona del team decide ognuna; solo una foto `approved` è visibile agli altri e conta per la
 * completezza. Una foto respinta non si pubblica e non conta nei tentativi del profilo (D197).
 */
@Injectable()
export class PhotoReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  /** Coda "Foto nuove": foto in attesa di account già approvati, prima le più vecchie. */
  async newPhotosQueue(): Promise<NewPhotoEntry[]> {
    const rows = await this.db
      .select({
        id: photos.id,
        userId: photos.userId,
        position: photos.position,
        uploadedAt: photos.uploadedAt,
        storageKey: photos.storageKey,
        firstName: profiles.firstName,
      })
      .from(photos)
      .innerJoin(users, eq(users.id, photos.userId))
      .leftJoin(profiles, eq(profiles.userId, photos.userId))
      .where(
        and(
          eq(photos.status, 'pending_approval'),
          inArray(users.status, ['active', 'reverifying', 'suspended']),
        ),
      )
      .orderBy(asc(photos.uploadedAt))
      .limit(200);
    const now = Date.now();
    return Promise.all(
      rows.map(async (row) => {
        const dueAt = new Date(row.uploadedAt.getTime() + DUE_HOURS * 3_600_000);
        const url = await this.photoUrl(row.storageKey);
        return {
          id: row.id,
          userId: row.userId,
          firstName: row.firstName,
          position: row.position,
          uploadedAt: row.uploadedAt,
          submittedAt: row.uploadedAt,
          dueAt,
          minutesLeft: Math.floor((dueAt.getTime() - now) / 60_000),
          url,
          photo: { id: row.id, position: row.position, status: 'pending_approval', url },
        };
      }),
    );
  }

  /**
   * URL firmato di una foto del profilo per la revisione (approvazioni, coda di moderazione):
   * `storageKey` è la chiave di `photos`, la variante grande è `photoKeys().large`.
   */
  async photoUrl(storageKey: string): Promise<string> {
    return (await this.storage.signedGetUrl(photoKeys(storageKey).large, PHOTO_SECONDS)).url;
  }

  /**
   * Esito di una foto nuova o in revisione: `approved` la rende visibile, `rejected` la toglie.
   * Le foto dei profili ancora in approvazione si decidono con il profilo, non qui.
   */
  async decide(
    photoId: string,
    outcome: 'approved' | 'rejected',
    by: OperatorAction,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ userId: photos.userId, status: photos.status, userStatus: users.status })
        .from(photos)
        .innerJoin(users, eq(users.id, photos.userId))
        .where(eq(photos.id, photoId))
        .for('update', { of: photos });
      if (!row) throw ApiError.notFound();
      const reviewable =
        row.status === 'under_review' ||
        (row.status === 'pending_approval' && row.userStatus !== 'pending_approval');
      if (!reviewable) throw ApiError.conflict('conflict');
      await tx
        .update(photos)
        .set({ status: outcome, checkedAt: sql`now()` })
        .where(eq(photos.id, photoId));
      await this.audit.write(
        {
          type: 'action',
          action: outcome === 'approved' ? 'photo_approved' : 'photo_rejected',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: row.userId,
          explanation: by.explanation,
          details: { photoId, from: row.status },
        },
        tx,
      );
    });
  }
}
