import { Logger, type INestApplicationContext } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../infra/config/config';
import { DATABASE, Database } from '../infra/database/database';
import { EMAIL_SENDER, EmailSender } from '../infra/email/email-sender';
import {
  noticeEmail,
  teamAlertEmail,
  waitlistAnswerEmail,
} from '../infra/email/proposed-email-texts';
import { OBJECT_STORAGE, ObjectStorage } from '../infra/storage/object-storage';
import { AuditService } from '../infra/audit/audit.service';
import { NoticesService } from '../domain/safety/notices.service';
import { SafetySettings } from '../domain/safety/safety-settings.service';
import { StoreReviewService } from '../domain/safety/store-review.service';
import { AccountLifecycleService } from '../domain/account/account-lifecycle.service';
import { JobDefinition } from './job';

/** Lotto massimo per esecuzione: le cancellazioni vanno una transazione per account. */
const BATCH = 100;
const logger = new Logger('Jobs');

const db = (app: INestApplicationContext) => app.get<Database>(DATABASE);
const rows = async <T extends Record<string, unknown>>(
  app: INestApplicationContext,
  query: ReturnType<typeof sql>,
) => (await db(app).execute<T>(query)).rows;

/** Cancellazione definitiva di un account in una transazione propria (D98). */
async function deleteAccount(app: INestApplicationContext, userId: string): Promise<boolean> {
  try {
    // Account e file nell'archivio (foto, esportazioni): non resta nulla (D85, D185)
    await app.get(AccountLifecycleService).deleteNow(userId, false);
    return true;
  } catch {
    logger.warn('Cancellazione di un account non riuscita: si riprova al prossimo passaggio');
    return false;
  }
}

/**
 * Processi pianificati di sicurezza, moderazione, approvazione e amministrazione (team B3,
 * D239): nessuno approva un profilo o una foto (D144) né applica la regola core, che vale nelle
 * transazioni delle azioni.
 */
export const SAFETY_ADMIN_JOBS: JobDefinition[] = [
  {
    // Avvisi all'utente all'email personale: l'API di amministrazione non legge l'indirizzo
    name: 'send-notices',
    schedule: 'hourly',
    async run(app) {
      const sender = app.get<EmailSender>(EMAIL_SENDER);
      const pending = await rows<{
        id: string;
        template: string;
        params: Record<string, unknown>;
        email: string | null;
      }>(
        app,
        sql`
        select n.id, n.template, n.params, i.email from user_notices n
          left join personal_identities i on i.user_id = n.user_id and i.revoked_at is null
         where n.attempts < 5 order by n.created_at limit ${BATCH}`,
      );
      let sent = 0;
      for (const notice of pending) {
        const text = noticeEmail(notice.template, notice.params);
        try {
          if (text && notice.email) {
            await sender.send({ to: notice.email, from: 'project', ...text });
            sent++;
          }
          await db(app).execute(sql`delete from user_notices where id = ${notice.id}::uuid`);
        } catch {
          await db(app).execute(
            sql`update user_notices set attempts = attempts + 1 where id = ${notice.id}::uuid`,
          );
        }
      }
      return { sent, pending: pending.length };
    },
  },
  {
    name: 'send-waitlist-answers',
    schedule: 'hourly',
    async run(app) {
      const sender = app.get<EmailSender>(EMAIL_SENDER);
      const pending = await rows<{ id: string; contact_email: string }>(
        app,
        sql`select id, contact_email from waitlist_notices where attempts < 5 limit ${BATCH}`,
      );
      let sent = 0;
      for (const notice of pending) {
        try {
          await sender.send({
            to: notice.contact_email,
            from: 'project',
            ...waitlistAnswerEmail(),
          });
          await db(app).execute(sql`delete from waitlist_notices where id = ${notice.id}::uuid`);
          sent++;
        } catch {
          await db(app).execute(
            sql`update waitlist_notices set attempts = attempts + 1 where id = ${notice.id}::uuid`,
          );
        }
      }
      return { sent };
    },
  },
  {
    name: 'send-team-alerts',
    schedule: 'hourly',
    async run(app) {
      const to = app.get<AppConfig>(APP_CONFIG).adapters.teamAlertEmail;
      if (!to) return { sent: 0 };
      const sender = app.get<EmailSender>(EMAIL_SENDER);
      const pending = await rows<{ id: string; kind: string; counts: Record<string, unknown> }>(
        app,
        sql`select id, kind, counts from team_alerts where sent_at is null order by created_at limit ${BATCH}`,
      );
      for (const alert of pending) {
        await sender.send({ to, from: 'project', ...teamAlertEmail(alert.kind, alert.counts) });
        await db(app).execute(
          sql`update team_alerts set sent_at = now() where id = ${alert.id}::uuid`,
        );
      }
      return { sent: pending.length };
    },
  },
  {
    // Avviso al team a 20 ore e alla scadenza delle 24 (D144): nessun esito automatico
    name: 'approval-deadlines',
    schedule: 'hourly',
    async run(app) {
      const alertHours = await app.get(SafetySettings).int('approval.team_alert_hours', 20);
      const [counts] = await rows<{ profiles: number; photos: number; late: number }>(
        app,
        sql`
        with p as (
          update profile_reviews set team_alert_at = now()
           where outcome = 'pending' and team_alert_at is null
             and submitted_at <= now() - make_interval(hours => ${alertHours})
          returning 1),
        f as (
          update photos f set team_alert_at = now()
            from users x
           where x.id = f.user_id and f.status = 'pending_approval' and f.team_alert_at is null
             and x.status <> 'pending_approval'
             and f.uploaded_at <= now() - make_interval(hours => ${alertHours})
          returning 1)
        select (select count(*) from p)::int as profiles, (select count(*) from f)::int as photos,
               (select count(*) from profile_reviews
                 where outcome = 'pending' and due_at <= now())::int as late`,
      );
      const result = {
        profiles: counts?.profiles ?? 0,
        photos: counts?.photos ?? 0,
        late: counts?.late ?? 0,
      };
      if (result.profiles || result.photos) {
        await app.get(NoticesService).toTeam('approval-deadlines', result);
      }
      return result;
    },
  },
  {
    // Elementi della coda oltre i tre quarti del tempo o scaduti: avviso con i soli conteggi
    name: 'moderation-deadlines',
    schedule: 'hourly',
    async run(app) {
      const [counts] = await rows<{ near: number; late: number }>(
        app,
        sql`
        with marked as (
          update reports set alerted_at = now()
           where status = 'open' and not is_demo and reason <> 'works_at_my_company'
             and alerted_at is null
             and now() >= created_at + (due_at - created_at) * 0.75
          returning due_at)
        select (select count(*) from marked where due_at > now())::int as near,
               (select count(*) from marked where due_at <= now())::int as late`,
      );
      const result = { near: counts?.near ?? 0, late: counts?.late ?? 0 };
      if (result.near || result.late) {
        await app.get(NoticesService).toTeam('moderation-deadlines', result);
      }
      return result;
    },
  },
  {
    // Fine della sospensione disciplinare: la visibilità torna da sola, parte solo l'avviso
    name: 'end-sanctions',
    schedule: 'hourly',
    async run(app) {
      const ended = await rows<{ user_id: string }>(
        app,
        sql`
        update sanctions set end_notified_at = now()
         where type = 'disciplinary_suspension' and revoked_at is null
           and ends_at <= now() and end_notified_at is null and user_id is not null
        returning user_id`,
      );
      for (const row of ended) {
        await app.get(NoticesService).toUser(row.user_id, 'sanction.ended');
      }
      return { ended: ended.length };
    },
  },
  {
    // Fine dell'intervallo della rimozione (D85, D111, D185): account a lotti, poi l'azienda
    name: 'complete-company-removals',
    schedule: 'hourly',
    async run(app) {
      const due = await rows<{ id: string }>(
        app,
        sql`select id from companies where status = 'removing' and removal_final_at <= now()`,
      );
      let deleted = 0;
      let companies = 0;
      for (const company of due) {
        const users = await rows<{ id: string }>(
          app,
          sql`select id from users where company_id = ${company.id}::uuid order by id limit ${BATCH}`,
        );
        for (const user of users) if (await deleteAccount(app, user.id)) deleted++;
        const finished = await rows<{ done: boolean }>(
          app,
          sql`select finish_company_removal(${company.id}::uuid) as done`,
        );
        if (finished[0]?.done) {
          companies++;
          await app.get(AuditService).write({
            type: 'action',
            action: 'removal_completed',
            objectType: 'company',
            objectId: company.id,
            details: { accounts: deleted },
          });
        }
      }
      return { accounts: deleted, companies };
    },
  },
  {
    // Documenti della verifica dell'età caricati da più di 72 ore senza esito (D113)
    name: 'clean-age-verifications',
    schedule: 'hourly',
    async run(app) {
      const hours = await app.get(SafetySettings).int('age_verification.document_hours', 72);
      const stale = await rows<{ user_id: string; storage_key: string }>(
        app,
        sql`
        select user_id, storage_key from age_verifications
         where uploaded_at <= now() - make_interval(hours => ${hours})`,
      );
      const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
      for (const row of stale) {
        await storage.delete(row.storage_key);
        await db(app).execute(sql`
          update age_verifications set storage_key = null, uploaded_at = null
           where user_id = ${row.user_id}::uuid and storage_key = ${row.storage_key}`);
      }
      return { files: stale.length };
    },
  },
  {
    name: 'close-review-windows',
    schedule: 'hourly',
    async run(app) {
      const expired = await rows<{ id: string }>(
        app,
        sql`select id from store_review_windows where closed_at is null and closes_at <= now()`,
      );
      if (!expired.length) return { closed: 0 };
      return { closed: (await app.get(StoreReviewService).close(null)) ? 1 : 0 };
    },
  },
  {
    // Espulsioni e terzi rifiuti dopo 7 giorni senza un ricorso aperto: cancellazione (D75, D142)
    name: 'complete-expulsions',
    schedule: 'daily',
    async run(app) {
      const days = await app.get(SafetySettings).int('expulsion.deletion_days', 7);
      const due = await rows<{ id: string }>(
        app,
        sql`
        select distinct s.user_id as id from sanctions s
         where s.type = 'expulsion' and s.revoked_at is null and s.user_id is not null
           and s.starts_at <= now() - make_interval(days => ${days})
           and not exists (select 1 from appeals a where a.sanction_id = s.id and a.outcome = 'pending')
        union
        select r.user_id from profile_reviews r
          join users x on x.id = r.user_id and x.status = 'pending_approval'
         where r.outcome = 'rejected' and r.attempt = 3
           and r.decided_at <= now() - make_interval(days => ${days})
           and not exists (select 1 from appeals a where a.review_id = r.id and a.outcome = 'pending')
        limit ${BATCH}`,
      );
      let deleted = 0;
      for (const row of due) if (await deleteAccount(app, row.id)) deleted++;
      return { deleted };
    },
  },
  {
    // Profili rifiutati e non ripresentati: avviso qualche giorno prima, poi cancellazione (D197)
    name: 'delete-rejected-profiles',
    schedule: 'daily',
    async run(app) {
      const settings = app.get(SafetySettings);
      const days = await settings.int('approval.rejected_deletion_days', 30);
      const notice = await settings.int('approval.rejected_notice_days', 7);
      const toNotify = await rows<{ id: string; user_id: string }>(
        app,
        sql`
        select r.id, r.user_id from profile_reviews r
          join users x on x.id = r.user_id and x.status = 'pending_approval'
         where r.outcome = 'rejected' and r.attempt < 3 and r.deletion_notice_at is null
           and r.decided_at <= now() - make_interval(days => ${days - notice})
           and r.attempt = (select max(attempt) from profile_reviews where user_id = r.user_id)`,
      );
      for (const row of toNotify) {
        await db(app).transaction(async (tx) => {
          await tx.execute(
            sql`update profile_reviews set deletion_notice_at = now() where id = ${row.id}::uuid`,
          );
          await app.get(NoticesService).toUser(row.user_id, 'approval.deletion_soon', {}, tx);
        });
      }
      const due = await rows<{ user_id: string }>(
        app,
        sql`
        select r.user_id from profile_reviews r
          join users x on x.id = r.user_id and x.status = 'pending_approval'
         where r.outcome = 'rejected' and r.attempt < 3
           and r.decided_at <= now() - make_interval(days => ${days})
           and r.attempt = (select max(attempt) from profile_reviews where user_id = r.user_id)
         limit ${BATCH}`,
      );
      let deleted = 0;
      for (const row of due) if (await deleteAccount(app, row.user_id)) deleted++;
      return { notified: toNotify.length, deleted };
    },
  },
  {
    // Esito generico di "Lavora nella mia azienda" dopo un tempo fisso, uguale in ogni caso (D113)
    name: 'works-at-my-company-outcomes',
    schedule: 'daily',
    async run(app) {
      const days = await app.get(SafetySettings).int('works_at_my_company.outcome_days', 7);
      const closed = await rows<{ id: string }>(
        app,
        sql`
        update reports set status = 'closed', closed_at = now(), generic_outcome_at = now()
         where reason = 'works_at_my_company' and status = 'open'
           and created_at <= now() - make_interval(days => ${days})
        returning id`,
      );
      return { closed: closed.length };
    },
  },
  {
    // Avviso aggregato (D72): coppie di aziende sopra la soglia, da persone diverse, in 30 giorni
    name: 'directory-alerts',
    schedule: 'daily',
    async run(app) {
      const settings = app.get(SafetySettings);
      const threshold = await settings.int('directory_alerts.threshold', 3);
      const period = await settings.int('directory_alerts.period_days', 30);
      const created = await rows<{ id: string }>(
        app,
        sql`
        insert into directory_alerts (reporter_company_id, reported_company_id)
        select reporter_company_id, reported_company_id from reports
         where reason = 'works_at_my_company' and reporter_company_id is not null
           and reported_company_id is not null and reporter_company_id <> reported_company_id
           and not is_demo and created_at > now() - make_interval(days => ${period})
         group by reporter_company_id, reported_company_id
        having count(distinct reporter_id) >= ${threshold}
        on conflict do nothing
        returning id`,
      );
      if (created.length) {
        await app.get(NoticesService).toTeam('directory-alerts', { alerts: created.length });
      }
      return { alerts: created.length };
    },
  },
  {
    name: 'clean-blocked-hashes',
    schedule: 'daily',
    async run(app) {
      const removed = await rows(
        app,
        sql`delete from blocked_hashes where expires_at <= now() returning 1`,
      );
      return { removed: removed.length };
    },
  },
  {
    // Segnalazioni chiuse da 12 mesi con le copie; sanzioni e ricorsi senza account (D99, D112)
    name: 'clean-reports',
    schedule: 'daily',
    async run(app) {
      const storage = app.get<ObjectStorage>(OBJECT_STORAGE);
      const photos = await rows<{ storage_key: string }>(
        app,
        sql`
        select c.storage_key from report_contents c join reports r on r.id = c.report_id
         where c.storage_key is not null and r.status = 'closed'
           and r.closed_at <= now() - interval '12 months'`,
      );
      for (const photo of photos) await storage.delete(photo.storage_key).catch(() => undefined);
      const reports = await rows(
        app,
        sql`
        delete from reports where status = 'closed' and closed_at <= now() - interval '12 months'
        returning 1`,
      );
      const sanctions = await rows(
        app,
        sql`
        delete from sanctions where user_id is null and created_at <= now() - interval '12 months'
        returning 1`,
      );
      const reviews = await rows(
        app,
        sql`
        delete from profile_reviews where user_id is null and appeal_deadline_at <= now()
           and not exists (select 1 from appeals a
                            where a.review_id = profile_reviews.id and a.outcome = 'pending')
        returning 1`,
      );
      return { reports: reports.length, sanctions: sanctions.length, reviews: reviews.length };
    },
  },
  {
    name: 'clean-audit-log',
    schedule: 'daily',
    async run(app) {
      const [row] = await rows<{ removed: number }>(app, sql`select purge_audit_log() as removed`);
      return { removed: Number(row?.removed ?? 0) };
    },
  },
  {
    // Lista d'attesa: confermate da 90 giorni e non confermate da 24 ore (D95)
    name: 'clean-waitlist',
    schedule: 'daily',
    async run(app) {
      const removed = await rows(
        app,
        sql`delete from waitlist_requests where expires_at <= now() returning 1`,
      );
      return { waitlist: removed.length };
    },
  },
  {
    // Controllo di coerenza della regola core (RC-125): conteggi sempre a zero in condizioni normali
    name: 'check-core-rule',
    schedule: 'daily',
    async run(app) {
      const [row] = await rows<{ result: Record<string, number> }>(
        app,
        sql`select check_core_rule_consistency() as result`,
      );
      const counts = row?.result ?? {};
      if (Object.values(counts).some((value) => Number(value) > 0)) {
        await app.get(AuditService).write({
          type: 'security',
          action: 'consistency_anomaly',
          details: counts,
        });
        await app.get(NoticesService).toTeam('check-core-rule', counts);
      }
      return counts;
    },
  },
];
