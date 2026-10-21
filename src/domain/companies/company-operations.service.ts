import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor, pgErrorCode } from '../../infra/database/database';
import { companies, companyDomains } from '../../infra/database/schema';
import {
  directoryAlerts,
  waitlistNotices,
  waitlistRequests,
} from '../../infra/database/schema-safety';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { SafetySettings } from '../safety/safety-settings.service';
import { OperatorAction } from './companies.service';

export interface MoveCounts {
  usersMoved: number;
  matchesRevoked: number;
  likesDeleted: number;
}

export interface SimilarCompany {
  id: string;
  name: string;
  matchedOn: 'name' | 'domain';
}

export interface RemovalPreview {
  companyId: string;
  name: string;
  domains: string[];
  accountsCount: number;
}

export interface WaitlistGroup {
  domain: string;
  requests: number;
  suggestedNames: string[];
  firstAt: Date;
  lastAt: Date;
}

export interface DirectoryAlert {
  id: string;
  reporterCompany: string;
  reportedCompany: string;
  reporterCompanyId: string;
  reportedCompanyId: string;
  /** Finestra delle segnalazioni che hanno superato la soglia (D72, D197). */
  windowStartsAt: Date;
  windowEndsAt: Date;
  status: 'open' | 'closed';
}

/** Errore che annulla la transazione dell'anteprima dopo aver letto i conteggi. */
class PreviewRollback extends Error {
  constructor(readonly counts: MoveCounts) {
    super('anteprima');
  }
}

/**
 * Operazioni sull'elenco delle aziende che toccano gli utenti (P14, D59, D85, D94, D111, D120,
 * D175, D185): spostamenti di dominio, fusioni, rimozione di un dominio e di un'azienda con
 * intervallo e annullamento; più lista d'attesa (D95) e avvisi aggregati di "Lavora nella mia
 * azienda" (D72). Le scritture passano dalle funzioni con i privilegi del proprietario, nella
 * stessa transazione dell'audit; le anteprime eseguono la stessa transazione e la annullano.
 */
@Injectable()
export class CompanyOperationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly settings: SafetySettings,
  ) {}

  /** Avviso di somiglianza (D197): nomi o domini simili a quelli di un'azienda già presente. */
  async similar(
    input: { name?: string; domains?: string[] },
    exceptId?: string,
  ): Promise<SimilarCompany[]> {
    const found = new Map<string, SimilarCompany>();
    const name = input.name ? simplify(input.name) : '';
    if (name.length >= 3) {
      const rows = await this.db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(eq(companies.status, 'active'));
      for (const row of rows) {
        const other = simplify(row.name);
        if (row.id !== exceptId && (other.includes(name) || name.includes(other))) {
          found.set(row.id, { id: row.id, name: row.name, matchedOn: 'name' });
        }
      }
    }
    for (const domain of input.domains ?? []) {
      const stem = domainStem(domain);
      if (stem.length < 3) continue;
      const rows = await this.db
        .select({ id: companies.id, name: companies.name, domain: companyDomains.domain })
        .from(companyDomains)
        .innerJoin(companies, eq(companies.id, companyDomains.companyId))
        .where(sql`${companyDomains.domain} like ${`%${escapeLike(stem)}%`}`);
      for (const row of rows) {
        if (row.id !== exceptId && !found.has(row.id)) {
          found.set(row.id, { id: row.id, name: row.name, matchedOn: 'domain' });
        }
      }
    }
    return [...found.values()];
  }

  async previewMoveDomain(domain: string, targetId: string): Promise<MoveCounts> {
    return this.preview((tx) => this.runMoveDomain(tx, domain, targetId));
  }

  /** Spostamento di un dominio, con la conferma rafforzata verificata dal controller (D197). */
  async moveDomain(domain: string, targetId: string, by: OperatorAction): Promise<MoveCounts> {
    return this.translate(() =>
      this.db.transaction(async (tx) => {
        const counts = await this.runMoveDomain(tx, domain, targetId);
        await this.audit.write(
          {
            type: 'action',
            action: 'domain_moved',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: targetId,
            explanation: by.explanation,
            details: { ...counts },
          },
          tx,
        );
        return counts;
      }),
    );
  }

  async previewMerge(absorbedId: string, targetId: string): Promise<MoveCounts> {
    return this.preview((tx) => this.runMerge(tx, absorbedId, targetId));
  }

  async merge(absorbedId: string, targetId: string, by: OperatorAction): Promise<MoveCounts> {
    return this.translate(() =>
      this.db.transaction(async (tx) => {
        const counts = await this.runMerge(tx, absorbedId, targetId);
        await this.audit.write(
          {
            type: 'action',
            action: 'companies_merged',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: targetId,
            explanation: by.explanation,
            details: { absorbedId, ...counts },
          },
          tx,
        );
        return counts;
      }),
    );
  }

  /** Rimozione di un dominio (P14): ri-verifica per chi lo usa, nessuna revoca. */
  async removeDomain(companyId: string, domain: string, by: OperatorAction): Promise<number> {
    return this.translate(() =>
      this.db.transaction(async (tx) => {
        const locked = await tx
          .select({ id: companies.id })
          .from(companies)
          .where(eq(companies.id, companyId))
          .for('update');
        const [row] = await tx
          .select({ companyId: companyDomains.companyId })
          .from(companyDomains)
          .where(eq(companyDomains.domain, domain));
        if (!locked.length || !row || row.companyId !== companyId) throw ApiError.notFound();
        const result = await tx.execute<{ affected: number }>(
          sql`select remove_domain(${domain}) as affected`,
        );
        const affected = Number(result.rows[0]?.affected ?? 0);
        await this.audit.write(
          {
            type: 'action',
            action: 'domain_removed',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: companyId,
            explanation: by.explanation,
            details: { reverifications: affected },
          },
          tx,
        );
        return affected;
      }),
    );
  }

  /** Anteprima della rimozione (D111): numero degli account coinvolti e domini. */
  async removalPreview(companyId: string): Promise<RemovalPreview> {
    const [company] = await this.db
      .select({ id: companies.id, name: companies.name, status: companies.status })
      .from(companies)
      .where(eq(companies.id, companyId));
    if (!company || company.status === 'merged') throw ApiError.notFound();
    const domains = await this.db
      .select({ domain: companyDomains.domain })
      .from(companyDomains)
      .where(eq(companyDomains.companyId, companyId))
      .orderBy(asc(companyDomains.domain));
    const count = await this.db.execute<{ n: number }>(
      sql`select company_accounts_count(${companyId}::uuid) as n`,
    );
    return {
      companyId,
      name: company.name,
      domains: domains.map((row) => row.domain),
      accountsCount: Number(count.rows[0]?.n ?? 0),
    };
  }

  /** Avvio della rimozione (D85, D111, D120): utenti invisibili subito, preavviso neutro. */
  async startRemoval(companyId: string, by: OperatorAction): Promise<number> {
    const hours = await this.settings.int('company_removal.interval_hours', 24);
    return this.translate(() =>
      this.db.transaction(async (tx) => {
        const [company] = await tx
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, companyId))
          .for('update');
        if (!company) throw ApiError.notFound();
        const result = await tx.execute<{ affected: number }>(
          sql`select start_company_removal(${companyId}::uuid, ${hours}) as affected`,
        );
        const affected = Number(result.rows[0]?.affected ?? 0);
        // Il nome dell'azienda, non personale, resta solo qui per 12 mesi (D99, D185)
        await this.audit.write(
          {
            type: 'action',
            action: 'removal_started',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: companyId,
            explanation: by.explanation,
            details: { accounts: affected, hours, name: company.name },
          },
          tx,
        );
        return affected;
      }),
    );
  }

  async cancelRemoval(companyId: string, by: OperatorAction): Promise<number> {
    return this.translate(() =>
      this.db.transaction(async (tx) => {
        const result = await tx.execute<{ affected: number }>(
          sql`select cancel_company_removal(${companyId}::uuid) as affected`,
        );
        const affected = Number(result.rows[0]?.affected ?? 0);
        await this.audit.write(
          {
            type: 'action',
            action: 'removal_cancelled',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: companyId,
            explanation: by.explanation,
            details: { accounts: affected },
          },
          tx,
        );
        return affected;
      }),
    );
  }

  /** Lista d'attesa (D95): richieste confermate raggruppate per dominio, mai i contatti. */
  async waitlist(): Promise<WaitlistGroup[]> {
    const rows = await this.db
      .select({
        domain: waitlistRequests.domain,
        requests: sql<number>`count(*)::int`,
        names: sql<string[]>`coalesce(array_agg(distinct ${waitlistRequests.suggestedName})
                                filter (where ${waitlistRequests.suggestedName} is not null), '{}')`,
        firstAt: sql<Date>`min(${waitlistRequests.createdAt})`,
        lastAt: sql<Date>`max(${waitlistRequests.createdAt})`,
      })
      .from(waitlistRequests)
      .where(
        and(
          isNotNull(waitlistRequests.contactConfirmedAt),
          sql`${waitlistRequests.expiresAt} > now()`,
        ),
      )
      .groupBy(waitlistRequests.domain)
      .orderBy(sql`min(${waitlistRequests.createdAt})`);
    return rows.map((row) => ({
      domain: row.domain,
      requests: Number(row.requests),
      suggestedNames: row.names,
      firstAt: new Date(row.firstAt),
      lastAt: new Date(row.lastAt),
    }));
  }

  /**
   * Risposta alle richieste di un dominio (D95, P13): testo neutro uguale nella forma per
   * l'azienda aggiunta o non aggiunta, poi le richieste si cancellano.
   */
  async answerWaitlist(
    domain: string,
    by: OperatorAction | null,
    outcome: 'added' | 'not_added' | null = null,
    tx: Executor = this.db,
  ): Promise<number> {
    const run = async (executor: Executor) => {
      const removed = await executor
        .delete(waitlistRequests)
        .where(
          and(eq(waitlistRequests.domain, domain), isNotNull(waitlistRequests.contactConfirmedAt)),
        )
        .returning({ contactEmail: waitlistRequests.contactEmail });
      const contacts = [...new Set(removed.map((row) => row.contactEmail))];
      if (contacts.length) {
        await executor
          .insert(waitlistNotices)
          .values(contacts.map((contactEmail) => ({ contactEmail })));
      }
      if (by) {
        await this.audit.write(
          {
            type: 'action',
            action: 'waitlist_answered',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'waitlist',
            objectId: domain,
            explanation: by.explanation,
            details: { requests: removed.length, outcome },
          },
          executor,
        );
      }
      return removed.length;
    };
    return tx === this.db ? this.db.transaction(run) : run(tx);
  }

  async alerts(): Promise<DirectoryAlert[]> {
    const rows = await this.db.execute<{
      id: string;
      created_at: Date;
      reporter_id: string;
      reporter_name: string;
      reported_id: string;
      reported_name: string;
    }>(sql`
      select a.id, a.created_at, r.id as reporter_id, r.name as reporter_name,
             d.id as reported_id, d.name as reported_name
        from directory_alerts a
        join companies r on r.id = a.reporter_company_id
        join companies d on d.id = a.reported_company_id
       where a.closed_at is null
       order by a.created_at`);
    const period = await this.settings.int('directory_alerts.period_days', 30);
    return rows.rows.map((row) => {
      const end = new Date(row.created_at);
      return {
        id: row.id,
        reporterCompany: row.reporter_name,
        reportedCompany: row.reported_name,
        reporterCompanyId: row.reporter_id,
        reportedCompanyId: row.reported_id,
        windowStartsAt: new Date(end.getTime() - period * 86_400_000),
        windowEndsAt: end,
        status: 'open' as const,
      };
    });
  }

  async closeAlert(id: string, by: OperatorAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      const closed = await tx
        .update(directoryAlerts)
        .set({ closedAt: sql`now()`, closedBy: by.operatorId })
        .where(and(eq(directoryAlerts.id, id), isNull(directoryAlerts.closedAt)))
        .returning({ id: directoryAlerts.id });
      if (!closed.length) throw ApiError.notFound();
      await this.audit.write(
        {
          type: 'action',
          action: 'directory_alert_closed',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'directory_alert',
          objectId: id,
          explanation: by.explanation,
        },
        tx,
      );
    });
  }

  private async runMoveDomain(tx: Executor, domain: string, targetId: string): Promise<MoveCounts> {
    const result = await tx.execute<{
      users_moved: number;
      matches_revoked: number;
      likes_deleted: number;
    }>(sql`select * from move_domain(${domain}, ${targetId}::uuid)`);
    return toCounts(result.rows[0]);
  }

  private async runMerge(tx: Executor, absorbedId: string, targetId: string): Promise<MoveCounts> {
    const result = await tx.execute<{
      users_moved: number;
      matches_revoked: number;
      likes_deleted: number;
    }>(sql`select * from merge_companies(${absorbedId}::uuid, ${targetId}::uuid)`);
    return toCounts(result.rows[0]);
  }

  private async preview(run: (tx: Executor) => Promise<MoveCounts>): Promise<MoveCounts> {
    try {
      await this.translate(() =>
        this.db.transaction(async (tx) => {
          // I trigger differiti si controllano qui, prima di annullare: l'anteprima fallisce
          // come fallirebbe l'operazione vera
          const counts = await run(tx);
          await tx.execute(sql`set constraints all immediate`);
          throw new PreviewRollback(counts);
        }),
      );
    } catch (error) {
      if (error instanceof PreviewRollback) return error.counts;
      throw error;
    }
    throw new Error('anteprima senza esito');
  }

  /** Errori delle funzioni dell'elenco tradotti in risposte leggibili dal backoffice. */
  private async translate<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PreviewRollback || error instanceof ApiError) throw error;
      const code = pgErrorCode(error);
      if (code === 'SSC13') throw ApiError.notFound();
      if (code === 'SSC14' || code === 'SSC04') throw ApiError.conflict('company.incompatible');
      throw error;
    }
  }
}

function toCounts(
  row: { users_moved: number; matches_revoked: number; likes_deleted: number } | undefined,
): MoveCounts {
  return {
    usersMoved: Number(row?.users_moved ?? 0),
    matchesRevoked: Number(row?.matches_revoked ?? 0),
    likesDeleted: Number(row?.likes_deleted ?? 0),
  };
}

/** Nome semplificato per l'avviso di somiglianza: minuscolo, senza forme societarie né spazi. */
function simplify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(s\.?p\.?a|s\.?r\.?l|srl|spa|group|gruppo|consulting|advisory|partners)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Parte significativa del dominio: il nome prima dell'estensione, senza `www`. */
function domainStem(domain: string): string {
  const parts = domain
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  return (parts.length > 1 ? parts[parts.length - 2] : parts[0]) ?? '';
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
