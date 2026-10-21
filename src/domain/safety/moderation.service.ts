import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { photos } from '../../infra/database/schema';
import { reportContents, reports, sanctions } from '../../infra/database/schema-safety';
import { AuditService } from '../../infra/audit/audit.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError } from '../../infra/http/api-error';
import { OBJECT_STORAGE, ObjectStorage } from '../../infra/storage/object-storage';
import { photoKeys } from '../photos/photos.service';
import { OperatorAction } from '../companies/companies.service';
import { ContentCryptoService } from './content-crypto.service';
import { DecidedSanctionType, SanctionsService, SevereCase } from './sanctions.service';

export const MODERATION_DECISIONS = [
  'dismissed',
  'content_removed',
  'match_closed',
  'warning',
  'disciplinary_suspension',
  'expulsion',
] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];
export const REMOVABLE_FIELDS = ['bio', 'looking_for', 'first_name', 'last_name'] as const;
export type RemovableField = (typeof REMOVABLE_FIELDS)[number];

/** URL firmati delle foto della coda: pochi minuti (D113). */
const PHOTO_SECONDS = 5 * 60;

export interface QueueEntry {
  id: string;
  kind: 'report' | 'photo';
  reason: string | null;
  severity: 'severe' | 'standard';
  createdAt: Date;
  /** `null` per le segnalazioni dimostrative, che non hanno scadenza (D42). */
  dueAt: Date | null;
  minutesLeft: number | null;
  isDemo: boolean;
  /** Segnalazioni aperte sulla stessa persona (1 per le foto). */
  reportsCount: number;
}

/** Caso nella forma del backoffice: segnalazione o foto in revisione. */
export interface CaseView {
  id: string;
  kind: 'report' | 'photo';
  reason: string | null;
  severity: 'severe' | 'standard';
  reportsCount: number;
  createdAt: Date;
  dueAt: Date | null;
  subject: {
    userId: string;
    firstName: string | null;
    ageYears: number | null;
    status: string;
    bio: string | null;
    photos: { id: string; position: number; status: string; url: string | null }[];
  } | null;
  /** Segnalazioni aperte sulla stessa persona, mai chi le ha fatte (D71). */
  reports: { reason: string; note: string | null; createdAt: Date }[];
  /** Solo i messaggi allegati (D187). */
  flaggedMessages: { id: string; sentAt: Date | null; fromReported: boolean; text: string }[];
  photo: { id: string; position: number; status: string; url: string | null } | null;
  priorSanctions: number;
}

/** Nomi delle decisioni del backoffice accettati come sinonimi. */
export const DECISION_ALIASES: Record<string, ModerationDecision> = {
  dismiss: 'dismissed',
  remove_content: 'content_removed',
};

export interface CaseDetail {
  id: string;
  reason: string;
  text: string | null;
  source: string;
  fromMatch: boolean;
  severity: 'severe' | 'standard';
  status: string;
  createdAt: Date;
  dueAt: Date | null;
  isDemo: boolean;
  outcome: string | null;
  /** Chi segnala solo come codice pseudonimo (D71, RC-112). */
  reporterPseudonym: string | null;
  reported: {
    userId: string;
    status: string;
    firstName: string | null;
    ageYears: number | null;
    visible: boolean;
    previousSanctions: { type: string; startsAt: Date; revoked: boolean }[];
  } | null;
  messages: { byReported: boolean; sentAt: Date | null; text: string }[];
  profileTexts: { field: string; text: string }[];
  photos: { id: string; url: string | null }[];
}

export interface CaseDecision {
  decision: ModerationDecision;
  /** Motivazione per l'utente, obbligatoria per avviso, sospensione ed espulsione (D75). */
  userExplanation?: string;
  severeCase?: SevereCase | null;
  /** Per `content_removed`: testi del profilo da togliere e foto da respingere. */
  fields?: RemovableField[];
  photoIds?: string[];
}

/**
 * Coda di moderazione e decisioni (D71, D73, D74, D75, D113; architettura, "Coda di
 * moderazione"): segnalazioni aperte, tranne "Lavora nella mia azienda", e foto `under_review`,
 * per gravità e scadenza. Il Moderatore vede solo i contenuti copiati nella segnalazione, mai il
 * resto della chat, le email, "chi ti interessa", le aziende escluse, i blocchi né l'Open space
 * (D90, D187). Ogni decisione chiude il caso con l'esito generico a chi ha segnalato (D113).
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly crypto: ContentCryptoService,
    private readonly hashes: CryptoService,
    private readonly sanctions: SanctionsService,
    private readonly audit: AuditService,
  ) {}

  async queue(): Promise<QueueEntry[]> {
    const open = await this.db
      .select({
        id: reports.id,
        reason: reports.reason,
        severity: reports.severity,
        createdAt: reports.createdAt,
        dueAt: reports.dueAt,
        isDemo: reports.isDemo,
      })
      .from(reports)
      .where(and(eq(reports.status, 'open'), sql`${reports.reason} <> 'works_at_my_company'`))
      .orderBy(asc(reports.dueAt))
      .limit(200);
    const perPerson = await this.db.execute<{ id: string; n: number }>(sql`
      select r.id, (select count(*)::int from reports o
                     where o.reported_id = r.reported_id and o.status = 'open'
                       and o.reason <> 'works_at_my_company') as n
        from reports r where r.status = 'open' and r.reason <> 'works_at_my_company'`);
    const counts = new Map(perPerson.rows.map((row) => [row.id, Number(row.n)]));
    const photoRows = await this.db
      .select({ id: photos.id, uploadedAt: photos.uploadedAt })
      .from(photos)
      .where(eq(photos.status, 'under_review'))
      .orderBy(asc(photos.uploadedAt))
      .limit(200);
    const now = Date.now();
    const standardMs = 72 * 3_600_000;
    const entries: QueueEntry[] = [
      ...open.map((row) => ({
        id: row.id,
        kind: 'report' as const,
        reason: row.reason,
        severity: row.severity,
        createdAt: row.createdAt,
        dueAt: row.isDemo ? null : row.dueAt,
        minutesLeft: row.isDemo ? null : Math.floor((row.dueAt.getTime() - now) / 60_000),
        isDemo: row.isDemo,
        reportsCount: counts.get(row.id) ?? 1,
      })),
      // Foto segnalate dal controllo automatico: revisione manuale entro 72 ore (D73)
      ...photoRows.map((row) => {
        const dueAt = new Date(row.uploadedAt.getTime() + standardMs);
        return {
          id: row.id,
          kind: 'photo' as const,
          reason: null,
          severity: 'standard' as const,
          createdAt: row.uploadedAt,
          dueAt,
          minutesLeft: Math.floor((dueAt.getTime() - now) / 60_000),
          isDemo: false,
          reportsCount: 1,
        };
      }),
    ];
    const rank = (entry: QueueEntry) => (entry.severity === 'severe' ? 0 : 1);
    return entries.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    );
  }

  async detail(id: string): Promise<CaseDetail> {
    const [report] = await this.db.select().from(reports).where(eq(reports.id, id));
    if (!report || report.reason === 'works_at_my_company') throw ApiError.notFound();
    const key =
      report.contentKey && report.contentKeyVersion
        ? await this.crypto.openKey(report.contentKey, report.contentKeyVersion)
        : null;
    const contents = await this.db
      .select()
      .from(reportContents)
      .where(eq(reportContents.reportId, id))
      .orderBy(asc(reportContents.sourceAt), asc(reportContents.createdAt));
    const open = (row: (typeof contents)[number]) =>
      key && row.ciphertext && row.nonce ? this.crypto.open(key, row.ciphertext, row.nonce) : '';
    let reported: CaseDetail['reported'] = null;
    if (report.reportedId) {
      const card = await this.db.execute<{
        status: string;
        first_name: string | null;
        age_years: number | null;
        visible: boolean;
      }>(sql`select status, first_name, age_years, visible from backoffice_user_cards
              where user_id = ${report.reportedId}::uuid`);
      const previous = await this.db
        .select({
          type: sanctions.type,
          startsAt: sanctions.startsAt,
          revokedAt: sanctions.revokedAt,
        })
        .from(sanctions)
        .where(eq(sanctions.userId, report.reportedId))
        .orderBy(desc(sanctions.startsAt));
      const row = card.rows[0];
      if (row) {
        reported = {
          userId: report.reportedId,
          status: row.status,
          firstName: row.first_name,
          ageYears: row.age_years === null ? null : Number(row.age_years),
          visible: row.visible,
          previousSanctions: previous.map((item) => ({
            type: item.type,
            startsAt: item.startsAt,
            revoked: item.revokedAt !== null,
          })),
        };
      }
    }
    return {
      id: report.id,
      reason: report.reason,
      text: report.text,
      source: report.source,
      fromMatch: report.fromMatch,
      severity: report.severity,
      status: report.status,
      createdAt: report.createdAt,
      dueAt: report.isDemo ? null : report.dueAt,
      isDemo: report.isDemo,
      outcome: report.outcome,
      reporterPseudonym: report.reporterId ? this.pseudonym(report.reporterId) : null,
      reported,
      messages: contents
        .filter((row) => row.type === 'message')
        .map((row) => ({
          byReported: row.byReported === true,
          sentAt: row.sourceAt,
          text: open(row),
        })),
      profileTexts: contents
        .filter((row) => row.type === 'profile_text')
        .map((row) => ({ field: row.field ?? '', text: open(row) })),
      photos: await Promise.all(
        contents
          .filter((row) => row.type === 'photo' && row.storageKey)
          .map(async (row) => ({
            id: row.id,
            url: (await this.storage.signedGetUrl(row.storageKey!, PHOTO_SECONDS)).url,
          })),
      ),
    };
  }

  /** Caso per il backoffice: una segnalazione o una foto `under_review`. */
  async caseView(id: string): Promise<CaseView> {
    const [photo] = await this.db
      .select({
        id: photos.id,
        userId: photos.userId,
        position: photos.position,
        status: photos.status,
        storageKey: photos.storageKey,
        uploadedAt: photos.uploadedAt,
      })
      .from(photos)
      .where(and(eq(photos.id, id), eq(photos.status, 'under_review')));
    if (photo) {
      const subject = await this.subject(photo.userId, []);
      const url = (
        await this.storage.signedGetUrl(photoKeys(photo.storageKey).large, PHOTO_SECONDS)
      ).url;
      return {
        id,
        kind: 'photo',
        reason: null,
        severity: 'standard',
        reportsCount: 1,
        createdAt: photo.uploadedAt,
        dueAt: new Date(photo.uploadedAt.getTime() + 72 * 3_600_000),
        subject: subject.subject,
        reports: [],
        flaggedMessages: [],
        photo: { id, position: photo.position, status: photo.status, url },
        priorSanctions: subject.priorSanctions,
      };
    }
    const detail = await this.detail(id);
    const others = detail.reported
      ? await this.db
          .select({ reason: reports.reason, text: reports.text, createdAt: reports.createdAt })
          .from(reports)
          .where(
            and(
              eq(reports.reportedId, detail.reported.userId),
              eq(reports.status, 'open'),
              sql`${reports.reason} <> 'works_at_my_company'`,
            ),
          )
          .orderBy(asc(reports.createdAt))
      : [];
    const bio = detail.profileTexts.find((item) => item.field === 'bio')?.text ?? null;
    const contents = await this.db
      .select({ id: reportContents.id, type: reportContents.type })
      .from(reportContents)
      .where(eq(reportContents.reportId, id))
      .orderBy(asc(reportContents.sourceAt), asc(reportContents.createdAt));
    const messageIds = contents.filter((row) => row.type === 'message').map((row) => row.id);
    return {
      id,
      kind: 'report',
      reason: detail.reason,
      severity: detail.severity,
      reportsCount: Math.max(others.length, 1),
      createdAt: detail.createdAt,
      dueAt: detail.dueAt,
      subject: detail.reported
        ? {
            userId: detail.reported.userId,
            firstName: detail.reported.firstName,
            ageYears: detail.reported.ageYears,
            status: detail.reported.status,
            bio,
            photos: detail.photos.map((item, index) => ({
              id: item.id,
              position: index + 1,
              status: 'reported',
              url: item.url,
            })),
          }
        : null,
      reports: (others.length
        ? others
        : [{ reason: detail.reason, text: detail.text, createdAt: detail.createdAt }]
      ).map((item) => ({ reason: item.reason, note: item.text, createdAt: item.createdAt })),
      flaggedMessages: detail.messages.map((message, index) => ({
        id: messageIds[index] ?? String(index),
        sentAt: message.sentAt,
        fromReported: message.byReported,
        text: message.text,
      })),
      photo: null,
      priorSanctions: detail.reported?.previousSanctions.length ?? 0,
    };
  }

  /**
   * Decisione su un caso della coda: per una foto `dismiss` la approva e `remove_content` la
   * respinge (D73); per una segnalazione vale `decide`. Senza campi indicati, `remove_content`
   * toglie i testi del profilo segnalato (bio e "cosa cerchi") e, per le foto inappropriate,
   * respinge le foto approvate [Proposta].
   */
  async decideAny(id: string, input: CaseDecision, by: OperatorAction): Promise<void> {
    const [photo] = await this.db
      .select({ id: photos.id, userId: photos.userId })
      .from(photos)
      .where(and(eq(photos.id, id), eq(photos.status, 'under_review')));
    if (photo) {
      if (input.decision !== 'dismissed' && input.decision !== 'content_removed') {
        await this.db.transaction(async (tx) => {
          await tx
            .update(photos)
            .set({ status: 'rejected', checkedAt: sql`now()` })
            .where(eq(photos.id, id));
          await this.sanctions.apply(
            {
              userId: photo.userId,
              type: input.decision as DecidedSanctionType,
              userExplanation: input.userExplanation ?? '',
            },
            by,
            tx,
          );
        });
        return;
      }
      await this.db.transaction(async (tx) => {
        const outcome = input.decision === 'dismissed' ? 'approved' : 'rejected';
        await tx
          .update(photos)
          .set({ status: outcome, checkedAt: sql`now()` })
          .where(eq(photos.id, id));
        await this.audit.write(
          {
            type: 'action',
            action: outcome === 'approved' ? 'photo_approved' : 'photo_rejected',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'user',
            objectId: photo.userId,
            explanation: by.explanation,
            details: { photoId: id, from: 'under_review' },
          },
          tx,
        );
      });
      return;
    }
    if (input.decision === 'content_removed' && !input.fields?.length && !input.photoIds?.length) {
      const [report] = await this.db
        .select({ reason: reports.reason, reportedId: reports.reportedId })
        .from(reports)
        .where(eq(reports.id, id));
      if (!report) throw ApiError.notFound();
      let photoIds: string[] = [];
      if (report.reason === 'inappropriate_photos' && report.reportedId) {
        const approved = await this.db
          .select({ id: photos.id })
          .from(photos)
          .where(and(eq(photos.userId, report.reportedId), eq(photos.status, 'approved')));
        photoIds = approved.map((row) => row.id);
      }
      return this.decide(
        id,
        { ...input, fields: photoIds.length ? [] : ['bio', 'looking_for'], photoIds },
        by,
      );
    }
    return this.decide(id, input, by);
  }

  private async subject(userId: string, reportedPhotos: CaseView['photo'][]) {
    const card = await this.db.execute<{
      status: string;
      first_name: string | null;
      age_years: number | null;
      bio: string | null;
    }>(sql`select status, first_name, age_years, bio from backoffice_user_cards
            where user_id = ${userId}::uuid`);
    const prior = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(sanctions)
      .where(eq(sanctions.userId, userId));
    const row = card.rows[0];
    return {
      subject: row
        ? {
            userId,
            firstName: row.first_name,
            ageYears: row.age_years === null ? null : Number(row.age_years),
            status: row.status,
            bio: row.bio,
            photos: reportedPhotos.filter(
              (item): item is NonNullable<typeof item> => item !== null,
            ),
          }
        : null,
      priorSanctions: Number(prior[0]?.n ?? 0),
    };
  }

  /** Gravità alzata all'esame (architettura): la scadenza passa a 24 ore dalla segnalazione. */
  async raiseSeverity(id: string, by: OperatorAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(reports)
        .set({
          severity: 'severe',
          dueAt: sql`least(${reports.dueAt}, ${reports.createdAt} + interval '24 hours')`,
        })
        .where(and(eq(reports.id, id), eq(reports.status, 'open')))
        .returning({ id: reports.id });
      if (!updated.length) throw ApiError.notFound();
      await this.audit.write(
        {
          type: 'action',
          action: 'report_decided',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'report',
          objectId: id,
          explanation: by.explanation,
          details: { severity: 'severe' },
        },
        tx,
      );
    });
  }

  /** Decisione sul caso: archiviazione, rimozione di contenuti, chiusura del match o sanzione. */
  async decide(id: string, input: CaseDecision, by: OperatorAction): Promise<void> {
    const sanction = toSanction(input.decision);
    if (sanction && !input.userExplanation?.trim()) {
      throw ApiError.badRequest('validation', { field: 'userExplanation' });
    }
    if (input.decision === 'content_removed' && !input.fields?.length && !input.photoIds?.length) {
      throw ApiError.badRequest('validation', { field: 'fields' });
    }
    await this.db.transaction(async (tx) => {
      const [report] = await tx
        .select({
          id: reports.id,
          reportedId: reports.reportedId,
          reason: reports.reason,
          status: reports.status,
        })
        .from(reports)
        .where(eq(reports.id, id))
        .for('update');
      if (!report || report.reason === 'works_at_my_company') throw ApiError.notFound();
      if (report.status !== 'open') throw ApiError.conflict('conflict');
      if (input.decision === 'content_removed' && report.reportedId) {
        for (const field of input.fields ?? []) {
          await tx.execute(
            sql`select moderation_remove_profile_text(${report.reportedId}::uuid, ${field})`,
          );
        }
        if (input.photoIds?.length) {
          await tx
            .update(photos)
            .set({ status: 'rejected', checkedAt: sql`now()` })
            .where(and(eq(photos.userId, report.reportedId), inArray(photos.id, input.photoIds)));
        }
      }
      if (input.decision === 'match_closed') {
        await tx.execute(sql`select moderation_close_match(${id}::uuid)`);
      }
      if (sanction && report.reportedId) {
        await this.sanctions.apply(
          {
            userId: report.reportedId,
            type: sanction,
            severeCase: input.severeCase ?? null,
            reportId: id,
            userExplanation: input.userExplanation!,
          },
          by,
          tx,
        );
      }
      await tx
        .update(reports)
        .set({
          status: 'closed',
          outcome: input.decision,
          decidedBy: by.operatorId,
          decidedAt: sql`now()`,
          closedAt: sql`now()`,
          genericOutcomeAt: sql`now()`,
        })
        .where(eq(reports.id, id));
      await this.audit.write(
        {
          type: 'action',
          action: input.decision === 'content_removed' ? 'content_removed' : 'report_decided',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'report',
          objectId: id,
          explanation: by.explanation,
          details: {
            decision: input.decision,
            fields: input.fields?.length ?? 0,
            photos: input.photoIds?.length ?? 0,
          },
        },
        tx,
      );
    });
  }

  /**
   * Sanzione per una segnalazione falsa volontaria (D113): l'account di chi ha segnalato si
   * ricava dalla segnalazione e il Moderatore non ne vede mai l'identità.
   */
  async sanctionReporter(
    id: string,
    input: { type: DecidedSanctionType; userExplanation: string },
    by: OperatorAction,
  ): Promise<void> {
    const [report] = await this.db
      .select({ reporterId: reports.reporterId })
      .from(reports)
      .where(eq(reports.id, id));
    if (!report?.reporterId) throw ApiError.notFound();
    await this.sanctions.apply(
      {
        userId: report.reporterId,
        type: input.type,
        reportId: id,
        userExplanation: input.userExplanation,
      },
      by,
    );
  }

  /** Utente segnalato in un caso aperto o in attesa di revisione: il Moderatore può vederlo. */
  async inModeratorScope(userId: string): Promise<boolean> {
    const result = await this.db.execute<{ ok: boolean }>(sql`
      select exists (select 1 from reports where reported_id = ${userId}::uuid and status = 'open')
          or exists (select 1 from profile_reviews
                      where user_id = ${userId}::uuid and outcome = 'pending')
          or exists (select 1 from photos where user_id = ${userId}::uuid
                                            and status in ('pending_approval', 'under_review'))
          as ok`);
    return result.rows[0]?.ok === true;
  }

  /** Codice pseudonimo stabile di chi segnala, utile a riconoscere segnalazioni ripetute. */
  private pseudonym(reporterId: string): string {
    return this.hashes.hash('reporter-pseudonym', reporterId).split(':')[1]!.slice(0, 10);
  }

  /** Segnalazioni ricevute da un utente (scheda del backoffice), mai chi le ha fatte. */
  async reportsAgainst(userId: string) {
    return this.db
      .select({
        id: reports.id,
        reason: reports.reason,
        severity: reports.severity,
        createdAt: reports.createdAt,
        status: reports.status,
        outcome: reports.outcome,
      })
      .from(reports)
      .where(eq(reports.reportedId, userId))
      .orderBy(desc(reports.createdAt))
      .limit(50);
  }
}

function toSanction(decision: ModerationDecision): DecidedSanctionType | null {
  if (
    decision === 'warning' ||
    decision === 'disciplinary_suspension' ||
    decision === 'expulsion'
  ) {
    return decision;
  }
  return null;
}
