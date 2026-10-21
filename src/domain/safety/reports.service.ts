import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { reportContents, reports } from '../../infra/database/schema-safety';
import { OBJECT_STORAGE, ObjectStorage } from '../../infra/storage/object-storage';
import { photoKeys } from '../photos/photos.service';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { ContentCryptoService } from './content-crypto.service';
import { SafetySettings } from './safety-settings.service';

export const REPORT_REASONS = [
  'fake_profile',
  'inappropriate_photos',
  'harassment',
  'spam_scam',
  'possible_minor',
  'works_at_my_company',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportSource = 'feed' | 'match' | 'chat';

export interface NewReport {
  userId: string;
  reason: ReportReason;
  source: ReportSource;
  text?: string | null;
  matchId?: string | null;
  messageIds?: string[];
  containsThreats?: boolean;
}

/** Testi del profilo copiati nella segnalazione (D71): mai "chi ti interessa" né la città. */
const PROFILE_FIELDS = ['first_name', 'last_name', 'bio', 'looking_for', 'practice_area'] as const;
/** Massimo di messaggi allegati a una segnalazione [Proposta]. */
export const MAX_ATTACHED_MESSAGES = 20;

interface PartyRow extends Record<string, unknown> {
  id: string;
  company_id: string | null;
  is_demo: boolean;
  status: string;
  ad_hoc_reverification_at: Date | string | null;
}

/**
 * Segnalazioni dall'app (D71, D72, D74, D113; architettura, "Segnalazioni e coda di
 * moderazione"). In un'unica transazione: match al momento della segnalazione, blocco automatico,
 * copia cifrata dei contenuti, gravità e scadenza, casi particolari di "possibile minorenne" e
 * "Lavora nella mia azienda". La risposta è una conferma neutra, uguale per ogni motivo, e chi è
 * segnalato non riceve nulla (anonimato, RC-112).
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly coreRule: CoreRuleService,
    private readonly crypto: ContentCryptoService,
    private readonly settings: SafetySettings,
    private readonly audit: AuditService,
  ) {}

  async create(me: string, input: NewReport): Promise<void> {
    const target = input.userId;
    if (target === me) throw ApiError.notFound();
    if (input.reason === 'other' && !input.text?.trim()) {
      throw ApiError.badRequest('report.reason.error');
    }
    if (input.messageIds?.length && !input.matchId) throw ApiError.badRequest('validation');
    const dailyMax = await this.settings.int('reports.daily_max', 10);
    const [today] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.reporterId, me), sql`${reports.createdAt} > now() - interval '1 day'`));
    if ((today?.n ?? 0) >= dailyMax) throw ApiError.tooManyRequests();
    await this.assertCanReport(me, target, input.matchId ?? null);
    // "Lavora nella mia azienda" non si offre tra colleghi con Open space reciproco (RC-157):
    // se arriva, la risposta è quella di un motivo non valido
    if (
      input.reason === 'works_at_my_company' &&
      (await this.coreRule.openSpaceColleagues(me, target))
    ) {
      throw ApiError.badRequest('validation');
    }
    const severeHours = await this.settings.int('moderation.severe_hours', 24);
    const standardHours = await this.settings.int('moderation.standard_hours', 72);
    const key = await this.crypto.newKey();
    const photos: { reportId: string; storageKey: string; photoId: string }[] = [];
    await this.db.transaction(async (tx) => {
      const parties = await tx.execute<PartyRow>(sql`
        select id, company_id, is_demo, status, ad_hoc_reverification_at from users
         where id in (${me}::uuid, ${target}::uuid) order by id for update`);
      const reporter = parties.rows.find((row) => row.id === me);
      const reported = parties.rows.find((row) => row.id === target);
      if (!reporter || !reported) throw ApiError.notFound();
      // 1. Match al momento della segnalazione, prima del blocco che lo chiude (D113)
      const active = await tx.execute<{ id: string }>(sql`
        select id from matches
         where status = 'active' and user_a_id = least(${me}::uuid, ${target}::uuid)
           and user_b_id = greatest(${me}::uuid, ${target}::uuid)`);
      const fromMatch = active.rows.length > 0;
      const severe = input.reason === 'possible_minor' || input.containsThreats === true;
      const hours = severe ? severeHours : standardHours;
      const works = input.reason === 'works_at_my_company';
      const [report] = await tx
        .insert(reports)
        .values({
          reporterId: me,
          reportedId: target,
          reason: input.reason,
          text: input.text?.trim() || null,
          source: input.source,
          fromMatch,
          severity: severe ? 'severe' : 'standard',
          containsThreats: input.containsThreats === true,
          // Le segnalazioni dimostrative non hanno scadenza (D42): la coda non la mostra
          dueAt: reporter.is_demo
            ? sql`now() + interval '10 years'`
            : sql`now() + make_interval(hours => ${hours})`,
          isDemo: reporter.is_demo,
          matchId: input.matchId ?? active.rows[0]?.id ?? null,
          reporterCompanyId: works ? reporter.company_id : null,
          reportedCompanyId: works ? reported.company_id : null,
          contentKey: key.wrapped,
          contentKeyVersion: key.keyVersion,
        })
        .returning({ id: reports.id });
      const reportId = report!.id;
      // 2. Blocco automatico (D71), come in "Blocchi": match chiuso, like cancellati
      await this.block(tx, me, target);
      // 3. Copia cifrata dei contenuti
      await this.copyContents(tx, reportId, key.plain, me, target, input);
      const approved = await tx.execute<{ id: string; storage_key: string }>(sql`
        select id, storage_key from photos where user_id = ${target}::uuid and status = 'approved'
         order by position`);
      for (const photo of approved.rows) {
        const storageKey = `reports/${reportId}/${photo.id}`;
        await tx.insert(reportContents).values({ reportId, type: 'photo', storageKey });
        // Copia della variante grande della foto del profilo (`photoKeys`)
        photos.push({ reportId, storageKey, photoId: photoKeys(photo.storage_key).large });
      }
      // 5. Casi particolari
      if (input.reason === 'possible_minor') {
        await this.possibleMinor(tx, reportId, me, target, fromMatch);
      }
      if (works) {
        const days = await this.settings.int('works_at_my_company.reverification_days', 30);
        const last = reported.ad_hoc_reverification_at
          ? new Date(reported.ad_hoc_reverification_at)
          : null;
        if (!last || Date.now() - last.getTime() > days * 86_400_000) {
          await tx.execute(sql`select start_reverification(${target}::uuid, 'ad_hoc')`);
        }
      }
    });
    // Copia delle foto nell'area privata, fuori dalla transazione: un errore non perde il caso
    for (const photo of photos) {
      try {
        if (await this.storage.exists(photo.photoId)) {
          await this.storage.copy(photo.photoId, photo.storageKey);
        }
      } catch {
        this.logger.warn('Copia di una foto segnalata non riuscita');
      }
    }
  }

  /** Esiti generici delle proprie segnalazioni (D113): nessun dettaglio sulla decisione. */
  async outcomesFor(
    me: string,
  ): Promise<{ id: string; createdAt: Date; reviewedAt: Date | null }[]> {
    const rows = await this.db
      .select({
        id: reports.id,
        createdAt: reports.createdAt,
        reviewedAt: reports.genericOutcomeAt,
      })
      .from(reports)
      .where(eq(reports.reporterId, me))
      .orderBy(desc(reports.createdAt))
      .limit(50);
    return rows;
  }

  /**
   * Si segnala chi si vede (feed o profilo, `can_interact`), una persona di un proprio match
   * attivo o chiuso da meno di 30 giorni, anche se l'altra ha chiuso o bloccato, oppure una
   * persona bloccata dall'elenco "Persone bloccate". Altrimenti `404` neutro.
   */
  private async assertCanReport(me: string, target: string, matchId: string | null): Promise<void> {
    if (matchId) {
      const result = await this.db.execute<{ ok: boolean }>(sql`
        select exists (select 1 from matches m
                        where m.id = ${matchId}::uuid
                          and ${me}::uuid in (m.user_a_id, m.user_b_id)
                          and ${target}::uuid in (m.user_a_id, m.user_b_id)
                          and (m.status = 'active' or m.closed_at > now() - interval '30 days'))
               as ok`);
      if (result.rows[0]?.ok === true) return;
      throw ApiError.notFound();
    }
    if (await this.coreRule.canInteract(me, target)) return;
    const blocked = await this.db.execute<{ ok: boolean }>(sql`
      select exists (select 1 from blocks where from_user_id = ${me}::uuid
                                             and to_user_id = ${target}::uuid
                                             and unblocked_at is null) as ok`);
    if (blocked.rows[0]?.ok !== true) throw ApiError.notFound();
  }

  /** Blocco automatico nei due sensi, come `POST /blocks` (D70, D71). */
  private async block(tx: Executor, me: string, target: string): Promise<void> {
    await tx.execute(sql`
      insert into blocks (from_user_id, to_user_id) values (${me}::uuid, ${target}::uuid)
      on conflict (from_user_id, to_user_id)
        do update set unblocked_at = null, created_at = now()`);
    await tx.execute(sql`
      update matches set status = 'closed', close_reason = 'blocked', closed_at = now()
       where status = 'active' and user_a_id = least(${me}::uuid, ${target}::uuid)
         and user_b_id = greatest(${me}::uuid, ${target}::uuid)`);
    await tx.execute(sql`
      delete from swipes where type in ('like', 'escalation')
         and ((from_user_id = ${me}::uuid and to_user_id = ${target}::uuid)
           or (from_user_id = ${target}::uuid and to_user_id = ${me}::uuid))`);
  }

  private async copyContents(
    tx: Executor,
    reportId: string,
    key: Buffer,
    me: string,
    target: string,
    input: NewReport,
  ): Promise<void> {
    const ids = [...new Set(input.messageIds ?? [])].slice(0, MAX_ATTACHED_MESSAGES);
    if (ids.length && input.matchId) {
      const messages = await tx.execute<{
        sender_id: string;
        created_at: Date;
        ciphertext: Buffer;
        nonce: Buffer;
      }>(sql`
        select sender_id, created_at, ciphertext, nonce from messages
         where match_id = ${input.matchId}::uuid
           and id = any (${`{${ids.join(',')}}`}::uuid[])
           and sender_id in (${me}::uuid, ${target}::uuid)
         order by created_at`);
      const texts = await this.crypto.openMessages(
        input.matchId,
        messages.rows.map((row) => ({ ciphertext: row.ciphertext, nonce: row.nonce })),
        tx,
      );
      for (const [index, message] of messages.rows.entries()) {
        const text = texts[index];
        if (text === null || text === undefined) continue;
        const sealed = this.crypto.seal(key, text);
        await tx.insert(reportContents).values({
          reportId,
          type: 'message',
          byReported: message.sender_id === target,
          sourceAt: new Date(message.created_at),
          ciphertext: sealed.ciphertext,
          nonce: sealed.nonce,
        });
      }
    }
    const profile = await tx.execute<Record<(typeof PROFILE_FIELDS)[number], string | null>>(sql`
      select first_name, last_name, bio, looking_for, practice_area from profiles
       where user_id = ${target}::uuid`);
    const row = profile.rows[0];
    for (const field of PROFILE_FIELDS) {
      const value = row?.[field];
      if (!value) continue;
      const sealed = this.crypto.seal(key, value);
      await tx.insert(reportContents).values({
        reportId,
        type: 'profile_text',
        field,
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
      });
    }
  }

  /**
   * "Possibile minorenne" (D113): sospensione cautelativa immediata solo da un match o con
   * un'altra segnalazione aperta dello stesso motivo da una persona diversa; altrimenti la
   * segnalazione resta nella coda delle gravi, senza sospensione.
   */
  private async possibleMinor(
    tx: Executor,
    reportId: string,
    me: string,
    target: string,
    fromMatch: boolean,
  ): Promise<void> {
    const other = await tx.execute<{ other: boolean }>(sql`
      select exists (select 1 from reports
                      where reported_id = ${target}::uuid and reason = 'possible_minor'
                        and status = 'open' and id <> ${reportId}::uuid
                        and reporter_id is distinct from ${me}::uuid) as other`);
    if (!fromMatch && other.rows[0]?.other !== true) return;
    const started = await tx.execute<{ id: string | null }>(
      sql`select start_precautionary_suspension(${target}::uuid, ${reportId}::uuid) as id`,
    );
    if (started.rows[0]?.id) {
      await this.audit.write(
        {
          type: 'security',
          action: 'precautionary_suspension_started',
          objectType: 'user',
          objectId: target,
          details: { fromMatch },
        },
        tx,
      );
    }
  }
}
