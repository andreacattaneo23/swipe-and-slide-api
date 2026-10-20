import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { photos, profileReviews, users } from '../../infra/database/schema';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { OperatorAction } from '../companies/companies.service';

/**
 * Motivi predefiniti del rifiuto (D197, AF "Rifiuti e tentativi") [Proposta: codici].
 * Il testo libero obbligatorio dice cosa correggere (D142).
 */
export const REJECTION_REASONS = [
  'inappropriate_photos',
  'photos_without_person',
  'fake_profile',
  'text_not_allowed',
  'reveals_company_or_clients',
  'other',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface QueueItem {
  reviewId: string;
  userId: string;
  attempt: number;
  submittedAt: Date;
  dueAt: Date;
  /** Minuti che restano alle 24 ore (negativi se in ritardo, D144). */
  minutesLeft: number;
  firstName: string | null;
  ageYears: number;
  gender: string | null;
  practiceArea: string | null;
  lookingFor: string | null;
  bio: string | null;
  companyName: string | null;
}

export interface ReviewDetail extends QueueItem {
  outcome: 'pending' | 'approved' | 'rejected';
  photos: { id: string; position: number; status: string }[];
  previousAttempts: { attempt: number; reason: string | null; explanation: string | null }[];
}

/** Durata della revisione (D141) e avviso al team (D144). */
const DUE_HOURS = 24;

/**
 * Approvazione manuale dei profili (D141–D144): presentazione, coda dalla più vecchia,
 * approvazione e rifiuto con motivazione, terzo rifiuto con il blocco di 2 anni. Ogni esito è di
 * una persona: il trigger `check_approval` impedisce l'approvazione senza revisione.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Prima presentazione o ripresentazione: nuova revisione con scadenza a 24 ore. */
  async submit(
    userId: string,
    tx: Executor,
  ): Promise<{ reviewId: string; attempt: number; dueAt: Date }> {
    const [last] = await tx
      .select({ attempt: sql<number>`coalesce(max(${profileReviews.attempt}), 0)::int` })
      .from(profileReviews)
      .where(eq(profileReviews.userId, userId));
    const attempt = (last?.attempt ?? 0) + 1;
    if (attempt > 3) throw ApiError.conflict('approval.attempts.exhausted');
    const [row] = await tx
      .insert(profileReviews)
      .values({ userId, attempt, dueAt: sql`now() + make_interval(hours => ${DUE_HOURS})` })
      .returning({ id: profileReviews.id, dueAt: profileReviews.dueAt });
    return { reviewId: row!.id, attempt, dueAt: row!.dueAt };
  }

  async queue(params: { limit: number; after?: string }): Promise<QueueItem[]> {
    const rows = await this.db.execute<QueueRow>(sql`
      select * from backoffice_approval_queue
       where outcome = 'pending'
         ${params.after ? sql`and submitted_at > ${params.after}::timestamptz` : sql``}
       order by submitted_at, review_id
       limit ${params.limit}`);
    return rows.rows.map(toQueueItem);
  }

  async detail(reviewId: string): Promise<ReviewDetail> {
    const result = await this.db.execute<QueueRow>(
      sql`select * from backoffice_approval_queue where review_id = ${reviewId}::uuid`,
    );
    const row = result.rows[0];
    if (!row) throw ApiError.notFound();
    const userPhotos = await this.db
      .select({ id: photos.id, position: photos.position, status: photos.status })
      .from(photos)
      .where(eq(photos.userId, row.user_id))
      .orderBy(photos.position);
    const previous = await this.db
      .select({
        attempt: profileReviews.attempt,
        reason: profileReviews.reason,
        explanation: profileReviews.explanation,
      })
      .from(profileReviews)
      .where(and(eq(profileReviews.userId, row.user_id), eq(profileReviews.outcome, 'rejected')))
      .orderBy(profileReviews.attempt);
    return {
      ...toQueueItem(row),
      outcome: row.outcome,
      photos: userPhotos,
      previousAttempts: previous,
    };
  }

  /** Approvazione: revisione, foto in attesa e account attivo nella stessa transazione. */
  async approve(reviewId: string, by: OperatorAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      const review = await this.lockPending(tx, reviewId);
      await tx
        .update(profileReviews)
        .set({ outcome: 'approved', decidedBy: by.operatorId, decidedAt: sql`now()` })
        .where(eq(profileReviews.id, reviewId));
      await tx
        .update(photos)
        .set({ status: 'approved', checkedAt: sql`now()` })
        .where(and(eq(photos.userId, review.userId), eq(photos.status, 'pending_approval')));
      await tx
        .update(users)
        .set({ status: 'active', deletionScheduledAt: null })
        .where(eq(users.id, review.userId));
      await this.audit.write(
        {
          type: 'action',
          action: 'profile_approved',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: review.userId,
          explanation: by.explanation,
          details: { attempt: review.attempt },
        },
        tx,
      );
    });
  }

  /**
   * Rifiuto con motivo e motivazione obbligatori (D91, D142); dopo il rifiuto la cancellazione
   * è prevista a 30 giorni. Al terzo rifiuto le impronte delle due email entrano in
   * `blocked_hashes` per 2 anni e parte il termine del ricorso (7 giorni).
   */
  async reject(
    reviewId: string,
    input: { reason: RejectionReason; explanation: string },
    by: OperatorAction,
  ): Promise<{ attempt: number; blocked: boolean }> {
    if (!input.explanation.trim()) throw ApiError.badRequest('approval.explanation.required');
    return this.db.transaction(async (tx) => {
      const review = await this.lockPending(tx, reviewId);
      const third = review.attempt >= 3;
      await tx
        .update(profileReviews)
        .set({
          outcome: 'rejected',
          decidedBy: by.operatorId,
          decidedAt: sql`now()`,
          reason: input.reason,
          explanation: input.explanation.trim(),
          appealDeadlineAt: third ? sql`now() + interval '7 days'` : null,
        })
        .where(eq(profileReviews.id, reviewId));
      await tx
        .update(users)
        .set({
          deletionScheduledAt: third
            ? sql`now() + interval '7 days'`
            : sql`now() + interval '30 days'`,
        })
        .where(eq(users.id, review.userId));
      await this.audit.write(
        {
          type: 'action',
          action: 'profile_rejected',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'user',
          objectId: review.userId,
          explanation: by.explanation,
          details: { attempt: review.attempt, reason: input.reason },
        },
        tx,
      );
      if (third) {
        const blocked = await tx.execute<{ written: number }>(
          sql`select block_third_rejection(${reviewId}::uuid) as written`,
        );
        await this.audit.write(
          {
            type: 'action',
            action: 'third_rejection_block',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'user',
            objectId: review.userId,
            explanation: by.explanation,
            details: { hashes: blocked.rows[0]?.written ?? 0 },
          },
          tx,
        );
      }
      return { attempt: review.attempt, blocked: third };
    });
  }

  private async lockPending(
    tx: Executor,
    reviewId: string,
  ): Promise<{ userId: string; attempt: number }> {
    const [review] = await tx
      .select({
        userId: profileReviews.userId,
        attempt: profileReviews.attempt,
        outcome: profileReviews.outcome,
      })
      .from(profileReviews)
      .where(eq(profileReviews.id, reviewId))
      .for('update');
    if (!review || !review.userId) throw ApiError.notFound();
    if (review.outcome !== 'pending') throw ApiError.conflict('approval.alreadyDecided');
    return { userId: review.userId, attempt: review.attempt };
  }
}

interface QueueRow extends Record<string, unknown> {
  review_id: string;
  user_id: string;
  attempt: number;
  submitted_at: string | Date;
  due_at: string | Date;
  outcome: 'pending' | 'approved' | 'rejected';
  first_name: string | null;
  age_years: number;
  gender: string | null;
  practice_area: string | null;
  looking_for: string | null;
  bio: string | null;
  company_name: string | null;
}

function toQueueItem(row: QueueRow): QueueItem {
  const dueAt = new Date(row.due_at);
  return {
    reviewId: row.review_id,
    userId: row.user_id,
    attempt: Number(row.attempt),
    submittedAt: new Date(row.submitted_at),
    dueAt,
    minutesLeft: Math.floor((dueAt.getTime() - Date.now()) / 60_000),
    firstName: row.first_name,
    ageYears: Number(row.age_years),
    gender: row.gender,
    practiceArea: row.practice_area,
    lookingFor: row.looking_for,
    bio: row.bio,
    companyName: row.company_name,
  };
}
