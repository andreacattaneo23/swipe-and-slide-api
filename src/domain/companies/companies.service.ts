import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ilike, inArray, sql } from 'drizzle-orm';
import {
  DATABASE,
  Database,
  Executor,
  DB_ERRORS,
  pgErrorCode,
} from '../../infra/database/database';
import { companies, companyDomains } from '../../infra/database/schema';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { isDisposable, isPersonalProvider } from '../email/email-address';

export interface CompanyRecord {
  id: string;
  name: string;
  status: 'active' | 'merged' | 'removing';
  isDemo: boolean;
  createdAt: Date;
  domains: string[];
  /** Fine dell'intervallo della rimozione, solo per le aziende `removing` (D111). */
  removalFinalAt: Date | null;
  /** Utenti in forma aggregata: `null` sotto la soglia di 10 persone (D89, D197). */
  usersCount: number | null;
}

/** Chi agisce dal backoffice e perché (D91): finisce nell'audit, senza dati personali. */
export interface OperatorAction {
  operatorId: string;
  sessionId: string;
  explanation: string;
}

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Elenco delle aziende curato dal team (D23, D24, D35, D84): solo il nome, N domini per
 * corrispondenza esatta (P12), nessuna associazione automatica. Usato dalla registrazione
 * (ricerca del dominio) e dal backoffice (gestione con audit e motivazione).
 */
@Injectable()
export class CompaniesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Azienda `active` del dominio esatto, o niente. */
  async findActiveByDomain(
    domain: string,
    tx: Executor = this.db,
  ): Promise<{ id: string; isDemo: boolean } | null> {
    const [row] = await tx
      .select({ id: companies.id, isDemo: companies.isDemo })
      .from(companyDomains)
      .innerJoin(companies, eq(companies.id, companyDomains.companyId))
      .where(and(eq(companyDomains.domain, domain), eq(companies.status, 'active')));
    return row ?? null;
  }

  /** Il dominio appartiene a un'azienda dell'elenco, in qualsiasi stato (email personale, D224). */
  async isListedDomain(domain: string, tx: Executor = this.db): Promise<boolean> {
    const [row] = await tx
      .select({ domain: companyDomains.domain })
      .from(companyDomains)
      .where(eq(companyDomains.domain, domain));
    return row !== undefined;
  }

  async list(params: { search?: string; after?: string; limit: number }): Promise<CompanyRecord[]> {
    const conditions = [];
    if (params.search) conditions.push(ilike(companies.name, `${escapeLike(params.search)}%`));
    if (params.after) conditions.push(gt(companies.name, params.after));
    const rows = await this.db
      .select()
      .from(companies)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(companies.name))
      .limit(params.limit);
    return this.withDomains(rows);
  }

  async get(id: string): Promise<CompanyRecord> {
    const [row] = await this.db.select().from(companies).where(eq(companies.id, id));
    if (!row) throw ApiError.notFound();
    const [company] = await this.withDomains([row]);
    return company!;
  }

  async create(
    input: { name: string; domains: string[]; isDemo: boolean },
    by: OperatorAction,
  ): Promise<CompanyRecord> {
    const domains = this.validDomains(input.domains);
    const id = await this.translate(() =>
      this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(companies)
          .values({ name: input.name.trim(), isDemo: input.isDemo, createdBy: by.operatorId })
          .returning({ id: companies.id });
        if (domains.length) {
          await tx
            .insert(companyDomains)
            .values(domains.map((domain) => ({ domain, companyId: created!.id })));
          await this.answerWaitlist(tx, domains);
        }
        await this.audit.write(
          {
            type: 'action',
            action: 'company_created',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: created!.id,
            explanation: by.explanation,
            details: { domains: domains.length, isDemo: input.isDemo },
          },
          tx,
        );
        return created!.id;
      }),
    );
    return this.get(id);
  }

  async rename(id: string, name: string, by: OperatorAction): Promise<CompanyRecord> {
    await this.translate(() =>
      this.db.transaction(async (tx) => {
        const updated = await tx
          .update(companies)
          .set({ name: name.trim() })
          .where(eq(companies.id, id))
          .returning({ id: companies.id });
        if (!updated.length) throw ApiError.notFound();
        await this.audit.write(
          {
            type: 'action',
            action: 'company_updated',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: id,
            explanation: by.explanation,
          },
          tx,
        );
      }),
    );
    return this.get(id);
  }

  async addDomain(id: string, domain: string, by: OperatorAction): Promise<CompanyRecord> {
    const [valid] = this.validDomains([domain]);
    await this.translate(() =>
      this.db.transaction(async (tx) => {
        await this.lockCompany(tx, id);
        await tx.insert(companyDomains).values({ domain: valid!, companyId: id });
        await this.answerWaitlist(tx, [valid!]);
        await this.audit.write(
          {
            type: 'action',
            action: 'domain_added',
            operatorId: by.operatorId,
            sessionId: by.sessionId,
            objectType: 'company',
            objectId: id,
            explanation: by.explanation,
          },
          tx,
        );
      }),
    );
    return this.get(id);
  }

  /**
   * Cancella un'azienda senza utenti (es. creata per errore). [Proposta] Con utenti vale la
   * rimozione con anteprima, intervallo e conferma rafforzata (D85, D93, D111): `409`.
   */
  async delete(id: string, by: OperatorAction): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.lockCompany(tx, id);
      const used = await tx.execute<{ used: boolean }>(
        sql`select company_has_users(${id}::uuid) as used`,
      );
      if (used.rows[0]?.used) throw ApiError.conflict('company.hasUsers');
      await tx.delete(companies).where(eq(companies.id, id));
      await this.audit.write(
        {
          type: 'action',
          action: 'company_deleted',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'company',
          objectId: id,
          explanation: by.explanation,
        },
        tx,
      );
    });
  }

  /**
   * Le richieste della lista d'attesa di un dominio appena aggiunto ricevono la risposta neutra
   * e si cancellano (D95, P13): `send-notices` invia l'email di contatto.
   */
  private async answerWaitlist(tx: Executor, domains: string[]): Promise<void> {
    await tx.execute(sql`
      with removed as (
        delete from waitlist_requests
         where domain = any (${`{${domains.join(',')}}`}::text[])
           and contact_confirmed_at is not null
        returning contact_email)
      insert into waitlist_notices (contact_email) select distinct contact_email from removed`);
  }

  private async lockCompany(tx: Executor, id: string): Promise<void> {
    const rows = await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, id))
      .for('update');
    if (!rows.length) throw ApiError.notFound();
  }

  /** Domini in minuscolo, mai provider personali né usa e getta (D24, RC-05). */
  private validDomains(domains: string[]): string[] {
    const normalized = [
      ...new Set(domains.map((domain) => domain.trim().toLowerCase().replace(/\.+$/, ''))),
    ];
    for (const domain of normalized) {
      if (!DOMAIN.test(domain)) throw ApiError.badRequest('company.domain.invalid');
      if (isPersonalProvider(domain) || isDisposable(domain)) {
        throw ApiError.badRequest('company.domain.notAllowed');
      }
    }
    return normalized;
  }

  private async withDomains(rows: (typeof companies.$inferSelect)[]): Promise<CompanyRecord[]> {
    if (!rows.length) return [];
    const domains = await this.db
      .select()
      .from(companyDomains)
      .where(
        inArray(
          companyDomains.companyId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(companyDomains.domain));
    const counts = await this.db.execute<{ id: string; n: number | null }>(sql`
      select id, company_users_aggregate(id) as n from companies
       where id = any (${`{${rows.map((row) => row.id).join(',')}}`}::uuid[])`);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      isDemo: row.isDemo,
      createdAt: row.createdAt,
      removalFinalAt: row.removalFinalAt,
      usersCount: ((n) => (n === null || n === undefined ? null : Number(n)))(
        counts.rows.find((count) => count.id === row.id)?.n,
      ),
      domains: domains
        .filter((domain) => domain.companyId === row.id)
        .map((domain) => domain.domain),
    }));
  }

  /** Nome o dominio già presenti diventano un `409` leggibile dal backoffice. */
  private async translate<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (pgErrorCode(error) === DB_ERRORS.uniqueViolation)
        throw ApiError.conflict('company.duplicate');
      throw error;
    }
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
