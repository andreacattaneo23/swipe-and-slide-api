import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { ageVerifications, sanctions } from '../../infra/database/schema-safety';
import { AuditService } from '../../infra/audit/audit.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError } from '../../infra/http/api-error';
import { OBJECT_STORAGE, ObjectStorage } from '../../infra/storage/object-storage';
import { OperatorAction } from '../companies/companies.service';
import { NoticesService } from './notices.service';
import { SanctionsService } from './sanctions.service';

/** URL firmati di pochi minuti (D113): caricamento dall'app, lettura dal Supporto. */
const UPLOAD_SECONDS = 15 * 60;
const VIEW_SECONDS = 5 * 60;

export interface AgeVerificationStatus {
  requested: boolean;
  requestedAt: Date | null;
  uploaded: boolean;
}

/**
 * Verifica dell'età per "possibile minorenne" (D76 rivista da D113): controllo del Supporto
 * senza conservare documenti. Il file sta in un'area temporanea dell'archivio, mai nel database
 * né nei registri; si cancella con l'esito e comunque entro 72 ore (processo
 * `clean-age-verifications`). Restano solo esito, data e operatore nell'audit.
 */
@Injectable()
export class AgeVerificationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly sanctions: SanctionsService,
    private readonly notices: NoticesService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async statusFor(userId: string): Promise<AgeVerificationStatus> {
    const [row] = await this.db
      .select()
      .from(ageVerifications)
      .where(eq(ageVerifications.userId, userId));
    return {
      requested: row !== undefined,
      requestedAt: row?.requestedAt ?? null,
      uploaded: row !== undefined && row.uploadedAt !== null,
    };
  }

  /** URL firmato per caricare il documento; un nuovo caricamento sostituisce il precedente. */
  async uploadUrl(userId: string): Promise<{ uploadUrl: string; expiresAt: Date; key: string }> {
    const [row] = await this.db
      .select({ userId: ageVerifications.userId })
      .from(ageVerifications)
      .where(eq(ageVerifications.userId, userId));
    if (!row) throw ApiError.notFound();
    const key = `age-verifications/${userId}/${this.crypto.randomToken(12).toLowerCase()}`;
    const signed = await this.storage.signedPutUrl(key, UPLOAD_SECONDS);
    return { uploadUrl: signed.url, expiresAt: signed.expiresAt, key };
  }

  /** Conferma del caricamento: il file deve esistere nell'area temporanea. */
  async confirmUpload(userId: string, key: string): Promise<void> {
    if (!key.startsWith(`age-verifications/${userId}/`)) throw ApiError.badRequest('validation');
    if (!(await this.storage.exists(key))) throw ApiError.badRequest('validation');
    const [previous] = await this.db
      .select({ storageKey: ageVerifications.storageKey })
      .from(ageVerifications)
      .where(eq(ageVerifications.userId, userId));
    if (!previous) throw ApiError.notFound();
    await this.db
      .update(ageVerifications)
      .set({ storageKey: key, uploadedAt: sql`now()` })
      .where(eq(ageVerifications.userId, userId));
    if (previous.storageKey && previous.storageKey !== key) {
      await this.storage.delete(previous.storageKey);
    }
  }

  /**
   * Richiesta della verifica dal backoffice (D113): parte anche la sospensione cautelativa, come
   * quando il Moderatore la avvia da una segnalazione.
   */
  async request(userId: string, by: OperatorAction, reportId: string | null = null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const exists = await tx.execute<{ id: string }>(
        sql`select id from users where id = ${userId}::uuid`,
      );
      if (!exists.rows.length) throw ApiError.notFound();
      await tx.execute(
        sql`select start_precautionary_suspension(${userId}::uuid, ${reportId}::uuid,
                                                  ${by.operatorId}::uuid)`,
      );
      await this.audit.write(
        {
          type: 'action',
          action: 'age_verification_requested',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: userId,
          explanation: by.explanation,
        },
        tx,
      );
      await this.notices.toUser(userId, 'age_verification.requested', {}, tx);
    });
  }

  /** Documento per il Supporto: URL firmato di pochi minuti, mai salvato né scaricabile. */
  async document(
    userId: string,
  ): Promise<AgeVerificationStatus & { documentUrl: string | null; expiresAt: Date | null }> {
    const [row] = await this.db
      .select()
      .from(ageVerifications)
      .where(eq(ageVerifications.userId, userId));
    if (!row) throw ApiError.notFound();
    const signed = row.storageKey
      ? await this.storage.signedGetUrl(row.storageKey, VIEW_SECONDS)
      : null;
    return {
      requested: true,
      requestedAt: row.requestedAt,
      uploaded: row.uploadedAt !== null,
      documentUrl: signed?.url ?? null,
      expiresAt: signed?.expiresAt ?? null,
    };
  }

  /**
   * Esito del Supporto (D113): il file si cancella e la riga si elimina nella stessa operazione;
   * maggiorenne, la sospensione cautelativa si revoca; minorenne, espulsione come nei casi gravi
   * (`false_statements`).
   */
  async recordOutcome(
    userId: string,
    outcome: 'adult' | 'minor',
    userExplanation: string,
    by: OperatorAction,
  ): Promise<void> {
    let storageKey: string | null = null;
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(ageVerifications)
        .where(eq(ageVerifications.userId, userId))
        .returning();
      if (!row) throw ApiError.notFound();
      if (!row.uploadedAt && outcome === 'minor') throw ApiError.conflict('conflict');
      storageKey = row.storageKey;
      const precautionary = await tx
        .select({ id: sanctions.id })
        .from(sanctions)
        .where(
          and(
            eq(sanctions.userId, userId),
            eq(sanctions.type, 'precautionary_suspension'),
            isNull(sanctions.revokedAt),
          ),
        );
      for (const sanction of precautionary) {
        await this.sanctions.revoke(sanction.id, by, tx, { notify: outcome === 'adult' });
      }
      if (outcome === 'minor') {
        await this.sanctions.apply(
          {
            userId,
            type: 'expulsion',
            severeCase: 'false_statements',
            reportId: row.reportId,
            userExplanation,
          },
          by,
          tx,
        );
      }
      await this.audit.write(
        {
          type: 'action',
          action: 'age_verification_recorded',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: userId,
          explanation: by.explanation,
          details: { outcome },
        },
        tx,
      );
    });
    if (storageKey) await this.storage.delete(storageKey);
  }
}
