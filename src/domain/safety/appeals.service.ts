import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { profileReviews, users } from '../../infra/database/schema';
import { appeals, sanctions } from '../../infra/database/schema-safety';
import { AuditService } from '../../infra/audit/audit.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError } from '../../infra/http/api-error';
import { OperatorAction } from '../companies/companies.service';
import { NoticesService } from './notices.service';
import { SafetySettings } from './safety-settings.service';
import { SanctionsService } from './sanctions.service';

/** Lunghezza massima del ricorso [Proposta di D233: 1000 caratteri, come i messaggi]. */
export const APPEAL_MAX_LENGTH = 1000;

export interface AppealSummary {
  id: string;
  kind: 'sanction' | 'third_rejection';
  sanctionType: string | null;
  submittedAt: Date;
  dueAt: Date;
  outcome: 'pending' | 'accepted' | 'rejected';
  /** Vero se l'operatore che legge ha deciso la sanzione o il rifiuto (D88). */
  decidedByMe: boolean;
  /** Nome del contratto del backoffice: tipo di sanzione o `third_rejection`. */
  subject: string;
}

export interface AppealDetail extends AppealSummary {
  text: string;
  userId: string | null;
  decisionExplanation: string | null;
  severeCase: string | null;
  reviewedAt: Date | null;
  responseExplanation: string | null;
  decidedAt: Date | null;
  /** Falso se chi legge ha deciso e nel team ci sono altre persone (D88). */
  canDecide: boolean;
}

/**
 * Ricorsi (D75, D113, D142; DSA art. 20): uno per sanzione o per il blocco dopo il terzo rifiuto,
 * entro 6 mesi dalla decisione (7 giorni per il terzo rifiuto), risposta entro 7 giorni da una
 * persona diversa da chi ha deciso quando nel team ce n'è più di una (D88). Accolto, la sanzione
 * si revoca con tutti i suoi effetti, impronte comprese; dopo il terzo rifiuto le impronte si
 * tolgono e, se l'account esiste ancora, il profilo si approva.
 */
@Injectable()
export class AppealsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly sanctions: SanctionsService,
    private readonly notices: NoticesService,
    private readonly settings: SafetySettings,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  /** Ricorso dall'app contro una propria sanzione. */
  async submitForSanction(userId: string, sanctionId: string, text: string): Promise<void> {
    // Solo le colonne leggibili dal ruolo dell'app
    const [sanction] = await this.db
      .select({ appealDeadlineAt: sanctions.appealDeadlineAt })
      .from(sanctions)
      .where(and(eq(sanctions.id, sanctionId), eq(sanctions.userId, userId)));
    if (!sanction) throw ApiError.notFound();
    await this.insert({ sanctionId, deadline: sanction.appealDeadlineAt, text });
  }

  /** Ricorso dall'app dopo il terzo rifiuto dell'approvazione (sessione `limited`). */
  async submitForThirdRejection(userId: string, text: string): Promise<void> {
    const [review] = await this.db
      .select()
      .from(profileReviews)
      .where(
        and(
          eq(profileReviews.userId, userId),
          eq(profileReviews.outcome, 'rejected'),
          eq(profileReviews.attempt, 3),
        ),
      );
    if (!review) throw ApiError.notFound();
    await this.insert({ reviewId: review.id, deadline: review.appealDeadlineAt, text });
  }

  /** Ricorso con il collegamento ricevuto all'email, anche dopo la cancellazione dell'account. */
  async submitWithCode(code: string, text: string): Promise<void> {
    const hash = this.crypto.hash('appeal-code', code);
    const [sanction] = await this.db
      .select({ id: sanctions.id, deadline: sanctions.appealDeadlineAt })
      .from(sanctions)
      .where(eq(sanctions.appealCodeHash, hash));
    if (sanction)
      return this.insert({ sanctionId: sanction.id, deadline: sanction.deadline, text });
    const [review] = await this.db
      .select({ id: profileReviews.id, deadline: profileReviews.appealDeadlineAt })
      .from(profileReviews)
      .where(eq(profileReviews.appealCodeHash, hash));
    if (review) return this.insert({ reviewId: review.id, deadline: review.deadline, text });
    throw ApiError.notFound();
  }

  async list(
    operatorId: string,
    params: { status?: 'pending' | 'closed' },
  ): Promise<AppealSummary[]> {
    const rows = await this.db
      .select({
        appeal: appeals,
        sanctionType: sanctions.type,
        sanctionDecidedBy: sanctions.decidedBy,
        reviewDecidedBy: profileReviews.decidedBy,
      })
      .from(appeals)
      .leftJoin(sanctions, eq(sanctions.id, appeals.sanctionId))
      .leftJoin(profileReviews, eq(profileReviews.id, appeals.reviewId))
      .where(
        params.status === 'closed'
          ? sql`${appeals.outcome} <> 'pending'`
          : eq(appeals.outcome, 'pending'),
      )
      .orderBy(params.status === 'closed' ? desc(appeals.reviewedAt) : asc(appeals.dueAt))
      .limit(100);
    return rows.map((row) => ({
      id: row.appeal.id,
      kind: row.appeal.sanctionId ? 'sanction' : 'third_rejection',
      sanctionType: row.sanctionType ?? null,
      submittedAt: row.appeal.submittedAt,
      dueAt: row.appeal.dueAt,
      outcome: row.appeal.outcome,
      decidedByMe: (row.sanctionDecidedBy ?? row.reviewDecidedBy) === operatorId,
      subject: row.sanctionType ?? 'third_rejection',
    }));
  }

  async get(operatorId: string, id: string): Promise<AppealDetail> {
    const [row] = await this.db
      .select({ appeal: appeals, sanction: sanctions, review: profileReviews })
      .from(appeals)
      .leftJoin(sanctions, eq(sanctions.id, appeals.sanctionId))
      .leftJoin(profileReviews, eq(profileReviews.id, appeals.reviewId))
      .where(eq(appeals.id, id));
    if (!row) throw ApiError.notFound();
    const decidedBy = row.sanction?.decidedBy ?? row.review?.decidedBy ?? null;
    return {
      id: row.appeal.id,
      kind: row.appeal.sanctionId ? 'sanction' : 'third_rejection',
      sanctionType: row.sanction?.type ?? null,
      submittedAt: row.appeal.submittedAt,
      dueAt: row.appeal.dueAt,
      outcome: row.appeal.outcome,
      decidedByMe: decidedBy === operatorId,
      text: row.appeal.text,
      userId: row.sanction?.userId ?? row.review?.userId ?? null,
      decisionExplanation: row.sanction?.explanation ?? row.review?.explanation ?? null,
      severeCase: row.sanction?.severeCase ?? null,
      reviewedAt: row.appeal.reviewedAt,
      responseExplanation: row.appeal.explanation,
      subject: row.sanction?.type ?? 'third_rejection',
      decidedAt: row.sanction?.startsAt ?? row.review?.decidedAt ?? null,
      canDecide:
        row.appeal.outcome === 'pending' &&
        (decidedBy !== operatorId || !(await this.othersCanReview(this.db, operatorId))),
    };
  }

  /**
   * Decisione sul ricorso, motivata (D91). Chi ha deciso la sanzione non decide il ricorso se
   * nel team ci sono altri operatori attivi con un ruolo che può farlo (D88).
   */
  async decide(
    id: string,
    input: { outcome: 'accepted' | 'rejected'; userExplanation: string },
    by: OperatorAction,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ appeal: appeals, sanction: sanctions, review: profileReviews })
        .from(appeals)
        .leftJoin(sanctions, eq(sanctions.id, appeals.sanctionId))
        .leftJoin(profileReviews, eq(profileReviews.id, appeals.reviewId))
        .where(eq(appeals.id, id))
        .for('update', { of: appeals });
      if (!row) throw ApiError.notFound();
      if (row.appeal.outcome !== 'pending') throw ApiError.conflict('conflict');
      const decidedBy = row.sanction?.decidedBy ?? row.review?.decidedBy ?? null;
      if (decidedBy === by.operatorId && (await this.othersCanReview(tx, by.operatorId))) {
        throw ApiError.forbidden();
      }
      await tx
        .update(appeals)
        .set({
          outcome: input.outcome,
          reviewedBy: by.operatorId,
          reviewedAt: sql`now()`,
          explanation: input.userExplanation.trim(),
        })
        .where(eq(appeals.id, id));
      const userId = row.sanction?.userId ?? row.review?.userId ?? null;
      if (input.outcome === 'accepted') {
        if (row.sanction) {
          if (!row.sanction.revokedAt) {
            await this.sanctions.revoke(row.sanction.id, by, tx, { notify: false });
          }
        } else if (row.review) {
          await tx.execute(
            sql`delete from blocked_hashes where review_id = ${row.review.id}::uuid`,
          );
          if (row.review.userId) {
            // Il profilo si approva con la revisione del terzo tentativo (D142)
            await tx
              .update(profileReviews)
              .set({ outcome: 'approved', decidedBy: by.operatorId, decidedAt: sql`now()` })
              .where(eq(profileReviews.id, row.review.id));
            await tx
              .update(users)
              .set({ status: 'active', deletionScheduledAt: null })
              .where(and(eq(users.id, row.review.userId), eq(users.status, 'pending_approval')));
          }
        }
      }
      await this.audit.write(
        {
          type: 'action',
          action: 'appeal_decided',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'appeal',
          objectId: id,
          explanation: by.explanation,
          details: { outcome: input.outcome, kind: row.sanction ? 'sanction' : 'third_rejection' },
        },
        tx,
      );
      if (userId) {
        await this.notices.toUser(
          userId,
          'appeal.decided',
          { outcome: input.outcome, explanation: input.userExplanation.trim() },
          tx,
        );
      }
    });
  }

  private async insert(params: {
    sanctionId?: string;
    reviewId?: string;
    deadline: Date | null;
    text: string;
  }): Promise<void> {
    const text = params.text.trim();
    if (!text || text.length > APPEAL_MAX_LENGTH) throw ApiError.badRequest('appeal.error');
    if (!params.deadline || params.deadline.getTime() <= Date.now()) {
      throw ApiError.conflict('conflict');
    }
    const days = await this.settings.int('appeals.response_days', 7);
    const inserted = await this.db
      .insert(appeals)
      .values({
        sanctionId: params.sanctionId ?? null,
        reviewId: params.reviewId ?? null,
        text,
        dueAt: sql`now() + make_interval(days => ${days})`,
      })
      .onConflictDoNothing()
      .returning({ id: appeals.id });
    // Un solo ricorso per decisione (D75)
    if (!inserted.length) throw ApiError.conflict('conflict');
  }

  private async othersCanReview(tx: Executor, operatorId: string): Promise<boolean> {
    const result = await tx.execute<{ others: boolean }>(sql`
      select exists (select 1 from operators where id <> ${operatorId}::uuid
                                              and status = 'active') as others`);
    return result.rows[0]?.others === true;
  }
}
