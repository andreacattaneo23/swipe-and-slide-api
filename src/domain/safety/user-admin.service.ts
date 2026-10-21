import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DATABASE, Database, DB_ERRORS, pgErrorCode } from '../../infra/database/database';
import {
  personalIdentities,
  photos,
  profileReviews,
  workEmails,
} from '../../infra/database/schema';
import { appeals, sanctions } from '../../infra/database/schema-safety';
import { AccountLifecycleService } from '../account/account-lifecycle.service';
import { AuditService } from '../../infra/audit/audit.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError } from '../../infra/http/api-error';
import { normalizeEmail } from '../email/email-address';
import { OperatorAction } from '../companies/companies.service';
import { ModerationService } from './moderation.service';
import { NoticesService } from './notices.service';
import { PhotoReviewService } from './photo-review.service';
import { SanctionsService } from './sanctions.service';

export interface UserSummary {
  id: string;
  status: string;
  isDemo: boolean;
  companyName: string | null;
  firstName: string | null;
  personalEmailMasked: string | null;
  workEmailMasked: string | null;
  /** Nomi del contratto del backoffice. */
  maskedWorkEmail: string | null;
  createdAt: Date;
}

export interface UserCard extends UserSummary {
  maskedPersonalEmail: string | null;
  approvedAt: Date | null;
  lastActiveAt: string | null;
  visible: boolean;
  companyId: string | null;
  signInMethod: string | null;
  workEmailVerifiedAt: Date | null;
  nextReverificationAt: Date | null;
  reverificationDueAt: Date | null;
  lastSeenOn: string | null;
  deletionScheduledAt: Date | null;
  deletionRequestedAt: Date | null;
  ageYears: number | null;
  gender: string | null;
  practiceArea: string | null;
  lookingFor: string | null;
  bio: string | null;
  photos: { id: string; position: number; status: string; url: string }[];
  reports: { id: string; reason: string; severity: string; status: string; createdAt: Date }[];
  sanctions: {
    id: string;
    type: string;
    severeCase: string | null;
    /** Motivazione della decisione per l'utente. */
    reason: string | null;
    startsAt: Date;
    endsAt: Date | null;
    revokedAt: Date | null;
    appealStatus: 'none' | 'pending' | 'upheld' | 'rejected';
  }[];
}

interface CardRow extends Record<string, unknown> {
  user_id: string;
  status: string;
  is_demo: boolean;
  created_at: Date | string;
  last_seen_on: string | null;
  reverification_due_at: Date | string | null;
  deletion_scheduled_at: Date | string | null;
  deletion_requested_at: Date | string | null;
  company_id: string | null;
  company_name: string | null;
  sign_in_method: string | null;
  personal_email_masked: string | null;
  work_email_masked: string | null;
  work_email_verified_at: Date | string | null;
  next_reverification_at: Date | string | null;
  first_name: string | null;
  age_years: number | null;
  gender: string | null;
  practice_area: string | null;
  looking_for: string | null;
  bio: string | null;
  visible: boolean;
}

const date = (value: Date | string | null): Date | null => (value ? new Date(value) : null);

/**
 * Utenti nel backoffice (D89, D90, D91, D93, D112): ricerca per email esatta (solo impronte) o per
 * identificativo, scheda dalla vista `backoffice_user_cards` con le email mascherate, e azioni con
 * la motivazione obbligatoria. Mai "chi ti interessa", aziende escluse, blocchi né Open space.
 */
@Injectable()
export class UserAdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly moderation: ModerationService,
    private readonly sanctionsService: SanctionsService,
    private readonly photoReview: PhotoReviewService,
    private readonly notices: NoticesService,
    private readonly lifecycle: AccountLifecycleService,
  ) {}

  /** Ricerca per email esatta (personale o aziendale attiva) o per identificativo. */
  async search(params: { email?: string; id?: string }): Promise<UserSummary[]> {
    let ids: string[] = [];
    if (params.id) ids = [params.id];
    if (params.email) {
      const email = normalizeEmail(params.email);
      if (!email) throw ApiError.badRequest('validation', { field: 'email' });
      // Stessa impronta usata dall'identità personale e dall'email aziendale
      const hash = this.crypto.hash('email', email.email);
      const personal = await this.db
        .select({ userId: personalIdentities.userId })
        .from(personalIdentities)
        .where(and(eq(personalIdentities.emailHash, hash), isNull(personalIdentities.revokedAt)));
      const work = await this.db
        .select({ userId: workEmails.userId })
        .from(workEmails)
        .where(and(eq(workEmails.emailHash, hash), eq(workEmails.status, 'active')));
      ids = [...new Set([...personal, ...work].map((row) => row.userId))];
    }
    if (!ids.length) return [];
    const rows = await this.db.execute<CardRow>(sql`
      select * from backoffice_user_cards
       where user_id = any (${`{${ids.join(',')}}`}::uuid[]) order by created_at`);
    return rows.rows.map(toSummary);
  }

  async card(userId: string): Promise<UserCard> {
    const result = await this.db.execute<CardRow>(
      sql`select * from backoffice_user_cards where user_id = ${userId}::uuid`,
    );
    const row = result.rows[0];
    if (!row) throw ApiError.notFound();
    const userPhotos = await this.db
      .select({
        id: photos.id,
        position: photos.position,
        status: photos.status,
        storageKey: photos.storageKey,
      })
      .from(photos)
      .where(eq(photos.userId, userId))
      .orderBy(asc(photos.position));
    const userSanctions = await this.db
      .select({
        id: sanctions.id,
        type: sanctions.type,
        severeCase: sanctions.severeCase,
        startsAt: sanctions.startsAt,
        endsAt: sanctions.endsAt,
        revokedAt: sanctions.revokedAt,
        reason: sanctions.explanation,
        appeal: appeals.outcome,
      })
      .from(sanctions)
      .leftJoin(appeals, eq(appeals.sanctionId, sanctions.id))
      .where(eq(sanctions.userId, userId))
      .orderBy(desc(sanctions.startsAt));
    const [approved] = await this.db
      .select({ at: profileReviews.decidedAt })
      .from(profileReviews)
      .where(and(eq(profileReviews.userId, userId), eq(profileReviews.outcome, 'approved')))
      .orderBy(desc(profileReviews.decidedAt))
      .limit(1);
    return {
      ...toSummary(row),
      maskedPersonalEmail: row.personal_email_masked,
      approvedAt: approved?.at ?? null,
      lastActiveAt: row.last_seen_on,
      visible: row.visible,
      companyId: row.company_id,
      signInMethod: row.sign_in_method,
      workEmailVerifiedAt: date(row.work_email_verified_at),
      nextReverificationAt: date(row.next_reverification_at),
      reverificationDueAt: date(row.reverification_due_at),
      lastSeenOn: row.last_seen_on,
      deletionScheduledAt: date(row.deletion_scheduled_at),
      deletionRequestedAt: date(row.deletion_requested_at),
      ageYears: row.age_years === null ? null : Number(row.age_years),
      gender: row.gender,
      practiceArea: row.practice_area,
      lookingFor: row.looking_for,
      bio: row.bio,
      photos: await Promise.all(
        userPhotos.map(async (photo) => ({
          id: photo.id,
          position: photo.position,
          status: photo.status,
          url: await this.photoReview.photoUrl(photo.storageKey),
        })),
      ),
      reports: await this.moderation.reportsAgainst(userId),
      sanctions: userSanctions.map(({ appeal, ...sanction }) => ({
        ...sanction,
        appealStatus:
          appeal === 'accepted'
            ? 'upheld'
            : appeal === 'pending' || appeal === 'rejected'
              ? appeal
              : 'none',
      })),
    };
  }

  /** Rivelazione di un'email (D90): la riga `email_revealed` precede la lettura, stessa transazione. */
  async revealEmail(
    userId: string,
    kind: 'personal' | 'work',
    by: OperatorAction,
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      await this.audit.write(
        {
          type: 'action',
          action: 'email_revealed',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: userId,
          explanation: by.explanation,
          details: { kind },
        },
        tx,
      );
      const result = await tx.execute<{ email: string | null }>(
        sql`select reveal_email(${userId}::uuid, ${kind}) as email`,
      );
      const email = result.rows[0]?.email;
      if (!email) throw ApiError.notFound();
      return email;
    });
  }

  /** Ri-verifica forzata (D197): per l'utente uguale alla periodica, senza il motivo. */
  async forceReverification(userId: string, by: OperatorAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      const result = await tx.execute<{ started: boolean }>(
        sql`select start_reverification(${userId}::uuid, 'ad_hoc') as started`,
      );
      if (result.rows[0]?.started !== true) throw ApiError.conflict('conflict');
      await this.audit.write(
        {
          type: 'action',
          action: 'reverification_forced',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: userId,
          explanation: by.explanation,
        },
        tx,
      );
      await this.notices.toUser(userId, 'reverification.started', {}, tx);
    });
  }

  /**
   * Riattivazione (D89) [Proposta]: revoca delle sospensioni in corso (disciplinare o
   * cautelativa); l'account torna com'era. L'espulsione si annulla solo con un ricorso accolto.
   */
  async reactivate(userId: string, by: OperatorAction): Promise<number> {
    return this.db.transaction(async (tx) => {
      const active = await tx
        .select({ id: sanctions.id })
        .from(sanctions)
        .where(
          and(
            eq(sanctions.userId, userId),
            isNull(sanctions.revokedAt),
            inArray(sanctions.type, ['disciplinary_suspension', 'precautionary_suspension']),
            or(isNull(sanctions.endsAt), sql`${sanctions.endsAt} > now()`),
          ),
        );
      if (!active.length) throw ApiError.conflict('conflict');
      for (const sanction of active) await this.sanctionsService.revoke(sanction.id, by, tx);
      await this.audit.write(
        {
          type: 'action',
          action: 'account_reactivated',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: userId,
          explanation: by.explanation,
          details: { sanctions: active.length },
        },
        tx,
      );
      return active.length;
    });
  }

  /** Correzione della data di nascita dal Supporto (D112): almeno 18 anni, solo l'età torna. */
  async correctBirthDate(userId: string, birthDate: string, by: OperatorAction): Promise<number> {
    try {
      return await this.db.transaction(async (tx) => {
        const result = await tx.execute<{ age: number }>(
          sql`select correct_birth_date(${userId}::uuid, ${birthDate}::date) as age`,
        );
        await this.audit.write(
          {
            type: 'action',
            action: 'birth_date_corrected',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'user',
            objectId: userId,
            explanation: by.explanation,
          },
          tx,
        );
        return Number(result.rows[0]?.age);
      });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === 'SSC12') throw ApiError.badRequest('registration.underage');
      if (code === 'SSC13') throw ApiError.notFound();
      throw error;
    }
  }

  /**
   * Cancellazione definitiva dal Supporto per una richiesta privacy (D83, D93), con la conferma
   * rafforzata verificata dal controller: `delete_account`, poi audit con il solo identificativo;
   * dopo il commit si cancellano foto ed esportazioni dall'archivio.
   */
  async delete(userId: string, by: OperatorAction): Promise<void> {
    const files = await this.db.transaction(async (tx) => {
      const exists = await tx.execute<{ id: string }>(
        sql`select user_id as id from backoffice_user_cards where user_id = ${userId}::uuid`,
      );
      if (!exists.rows.length) throw ApiError.notFound();
      const files = await this.lifecycle.filesOf(userId, tx);
      await tx.execute(sql`select delete_account(${userId}::uuid)`);
      await this.audit.write(
        {
          type: 'action',
          action: 'account_deleted',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: userId,
          explanation: by.explanation,
        },
        tx,
      );
      return files;
    });
    await this.lifecycle.removeFiles(files);
  }

  /** Errore del database tradotto per le azioni sugli utenti. */
  static translate(error: unknown): never {
    if (pgErrorCode(error) === DB_ERRORS.foreignKeyViolation) throw ApiError.conflict('conflict');
    throw error;
  }
}

function toSummary(row: CardRow): UserSummary {
  return {
    id: row.user_id,
    status: row.status,
    isDemo: row.is_demo,
    companyName: row.company_name,
    firstName: row.first_name,
    personalEmailMasked: row.personal_email_masked,
    workEmailMasked: row.work_email_masked,
    maskedWorkEmail: row.work_email_masked,
    createdAt: new Date(row.created_at),
  };
}
