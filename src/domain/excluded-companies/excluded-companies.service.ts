import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { asDate } from '../../infra/database/timestamps';
import { randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor, pgErrorCode } from '../../infra/database/database';
import { ApiError } from '../../infra/http/api-error';
import { ParametersService } from '../parameters/parameters.service';

/** Ritardo casuale delle modifiche: tra 24 e 47 ore, "entro due giorni" (D39). */
export const DELAY_SECONDS = { min: 24 * 3600, max: 47 * 3600 } as const;
/** Data massima mostrata all'utente: richiesta più 48 ore, mai la data esatta (D36). */
const LATEST_HOURS = 48;

export interface ExcludedCompany {
  id: string;
  name: string;
  /** Azienda lasciata al cambio di lavoro (D176): si toglie subito, senza i 7 giorni. */
  leftCompany: boolean;
  /** Solo se non si può ancora togliere: da quando si potrà (7 giorni, D87, D186). */
  removableFrom: Date | null;
}

export interface PendingChange {
  id: string;
  company: { id: string; name: string };
  operation: 'add' | 'remove';
  /** "Entro due giorni": la data massima, mai quella esatta di efficacia (D36, RC-67). */
  latestAt: Date;
}

export interface ExcludedCompaniesList {
  companies: ExcludedCompany[];
  pending: PendingChange[];
  /** Aziende escluse più aggiunte in attesa, sul massimo di 15 (D186). */
  count: number;
  max: number;
  /** Modifiche rimaste nei 30 giorni (5, D39) e, oltre il limite, la data da cui riprovare. */
  changesRemaining: number;
  changeableAt: Date | null;
  /** In approvazione le modifiche valgono subito (D166). */
  immediate: boolean;
}

export type ChangeOutcome = 'applied' | 'pending' | 'cancelled' | 'unchanged';

export interface ChangeResult {
  status: ChangeOutcome;
  latestAt: Date | null;
}

/**
 * Aziende escluse (D36, D39, D175, D176, D186): un solo elenco reciproco. Dopo l'approvazione
 * ogni modifica è una riga `pending` con una data di efficacia casuale, applicata dal processo
 * orario senza revoche (D58); in approvazione si scrive subito (D166). Unico modulo che scrive
 * `excluded_companies` e `excluded_company_changes`; non restituisce mai conteggi o elenchi di
 * persone (D36, RC-76).
 */
@Injectable()
export class ExcludedCompaniesService {
  private readonly logger = new Logger(ExcludedCompaniesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly parameters: ParametersService,
  ) {}

  async list(userId: string, tx: Executor = this.db): Promise<ExcludedCompaniesList> {
    const limits = await this.limits(tx);
    const [companies, pending, status, usage] = await Promise.all([
      tx.execute<{ id: string; name: string; source: string; removable_from: Date | null }>(sql`
        select z.id, z.name, e.source,
               case when e.source <> 'company_change'
                     and e.effective_at > now() - make_interval(days => ${limits.minDays})
                    then e.effective_at + make_interval(days => ${limits.minDays}) end as removable_from
          from excluded_companies e join companies z on z.id = e.company_id
         where e.user_id = ${userId}::uuid order by z.name`),
      tx.execute<{
        id: string;
        company_id: string;
        name: string;
        operation: 'add' | 'remove';
        latest_at: Date;
      }>(sql`
        select c.id, c.company_id, z.name, c.operation,
               c.requested_at + make_interval(hours => ${LATEST_HOURS}) as latest_at
          from excluded_company_changes c join companies z on z.id = c.company_id
         where c.user_id = ${userId}::uuid and c.status = 'pending' order by c.requested_at`),
      tx.execute<{ status: string; total: number }>(sql`
        select status, excluded_companies_total(id) as total from users where id = ${userId}::uuid`),
      this.usage(userId, tx, limits),
    ]);
    return {
      companies: companies.rows.map((row) => ({
        id: row.id,
        name: row.name,
        leftCompany: row.source === 'company_change',
        removableFrom: asDate(row.removable_from),
      })),
      pending: pending.rows.map((row) => ({
        id: row.id,
        company: { id: row.company_id, name: row.name },
        operation: row.operation,
        latestAt: asDate(row.latest_at)!,
      })),
      count: status.rows[0]?.total ?? 0,
      max: limits.max,
      changesRemaining: usage.remaining,
      changeableAt: usage.changeableAt,
      immediate: status.rows[0]?.status === 'pending_approval',
    };
  }

  /** Aggiunta di un'azienda: diretta in approvazione, altrimenti in attesa con il ritardo. */
  add(userId: string, companyId: string): Promise<ChangeResult> {
    return this.change(userId, companyId, 'add');
  }

  /** Rimozione di un'azienda: 7 giorni dopo l'efficacia, subito per l'azienda lasciata (D186). */
  remove(userId: string, companyId: string): Promise<ChangeResult> {
    return this.change(userId, companyId, 'remove');
  }

  /** Annullamento di una modifica in attesa: nessun effetto, non conta per il limite (D39). */
  async cancel(userId: string, changeId: string): Promise<void> {
    const result = await this.db.execute(sql`
      update excluded_company_changes set status = 'cancelled', closed_at = now()
       where id = ${changeId}::uuid and user_id = ${userId}::uuid and status = 'pending'`);
    if (!result.rowCount) throw ApiError.notFound();
  }

  /**
   * Effetti del cambio azienda sulle aziende escluse, nella transazione del cambio (D176, D186,
   * D158, AF "Cambio azienda", punto 4): l'azienda lasciata entra subito con origine
   * `company_change`, oltre il massimo e fuori dai limiti; le aggiunte in attesa diventano
   * efficaci subito; le rimozioni in attesa mantengono la loro data; la nuova azienda esce
   * dall'elenco con le sue modifiche in attesa. Va chiamata dopo aver aggiornato `users.company_id`.
   */
  async onCompanyChange(
    tx: Executor,
    userId: string,
    fromCompanyId: string | null,
    toCompanyId: string,
  ): Promise<{ leftCompanyExcluded: boolean; newCompanyUnexcluded: boolean }> {
    await tx.execute(sql`
      update excluded_company_changes set status = 'cancelled', closed_at = now()
       where user_id = ${userId}::uuid and status = 'pending'
         and company_id in (${toCompanyId}::uuid, ${fromCompanyId}::uuid)`);
    const removed = await tx.execute(sql`
      delete from excluded_companies where user_id = ${userId}::uuid and company_id = ${toCompanyId}::uuid`);
    // Aggiunte in attesa efficaci subito (D40 rivista da D175, AF): verso aziende ancora ammesse
    const adds = await tx.execute<{ id: string; company_id: string }>(sql`
      select c.id, c.company_id from excluded_company_changes c
        join companies z on z.id = c.company_id and z.status = 'active'
       where c.user_id = ${userId}::uuid and c.status = 'pending' and c.operation = 'add'
       order by c.requested_at`);
    for (const add of adds.rows) {
      await tx.execute(sql`
        insert into excluded_companies (user_id, company_id, source)
        values (${userId}::uuid, ${add.company_id}::uuid, 'user') on conflict do nothing`);
      await tx.execute(sql`
        update excluded_company_changes set status = 'applied', closed_at = now()
         where id = ${add.id}::uuid`);
    }
    let leftCompanyExcluded = false;
    if (fromCompanyId) {
      const left = await tx.execute<{ status: string }>(
        sql`select status from companies where id = ${fromCompanyId}::uuid`,
      );
      // L'azienda lasciata deve essere ancora nell'elenco (un'azienda in rimozione non entra)
      if (left.rows[0]?.status === 'active') {
        await tx.execute(sql`set constraints current_company_not_excluded deferred`);
        await tx.execute(sql`
          insert into excluded_companies (user_id, company_id, source)
          values (${userId}::uuid, ${fromCompanyId}::uuid, 'company_change')
          on conflict (user_id, company_id)
          do update set source = 'company_change', effective_at = now()`);
        leftCompanyExcluded = true;
      }
    }
    return { leftCompanyExcluded, newCompanyUnexcluded: (removed.rowCount ?? 0) > 0 };
  }

  /**
   * Processo orario `apply-excluded-company-changes`: modifiche scadute, una transazione per
   * utente, con il blocco della riga dell'utente e `SKIP LOCKED`; nessuna revoca (D58) né
   * notifica. Un'aggiunta non più ammissibile si chiude come annullata.
   */
  async applyDue(): Promise<{ applied: number; cancelled: number; failed: number }> {
    const due = await this.db.execute<{ user_id: string }>(sql`
      select distinct user_id from excluded_company_changes
       where status = 'pending' and effective_at <= now()`);
    let applied = 0;
    let cancelled = 0;
    let failed = 0;
    for (const { user_id: userId } of due.rows) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
          const changes = await tx.execute<{
            id: string;
            company_id: string;
            operation: 'add' | 'remove';
            admissible: boolean;
          }>(sql`
            select c.id, c.company_id, c.operation,
                   (z.status = 'active' and z.is_demo = x.is_demo
                    and z.id is distinct from x.company_id) as admissible
              from excluded_company_changes c
              join users x on x.id = c.user_id
              join companies z on z.id = c.company_id
             where c.user_id = ${userId}::uuid and c.status = 'pending' and c.effective_at <= now()
             order by c.effective_at
               for update of c skip locked`);
          for (const change of changes.rows) {
            if (change.operation === 'add' && !change.admissible) {
              await tx.execute(sql`
                update excluded_company_changes set status = 'cancelled', closed_at = now()
                 where id = ${change.id}::uuid`);
              cancelled++;
              continue;
            }
            if (change.operation === 'add') {
              await tx.execute(sql`
                insert into excluded_companies (user_id, company_id, source)
                values (${userId}::uuid, ${change.company_id}::uuid, 'user') on conflict do nothing`);
            } else {
              await tx.execute(sql`
                delete from excluded_companies
                 where user_id = ${userId}::uuid and company_id = ${change.company_id}::uuid`);
            }
            await tx.execute(sql`
              update excluded_company_changes set status = 'applied', closed_at = now()
               where id = ${change.id}::uuid`);
            applied++;
          }
        });
      } catch {
        failed++;
        this.logger.warn('Modifiche delle aziende escluse non applicate: nuovo tentativo');
      }
    }
    return { applied, cancelled, failed };
  }

  /** Processo giornaliero: modifiche applicate o annullate da più di 30 giorni. */
  async cleanClosed(): Promise<number> {
    const result = await this.db.execute(sql`
      delete from excluded_company_changes
       where status <> 'pending' and closed_at < now() - interval '30 days'`);
    return result.rowCount ?? 0;
  }

  private async change(
    userId: string,
    companyId: string,
    operation: 'add' | 'remove',
  ): Promise<ChangeResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const user = await tx.execute<{
          status: string;
          company_id: string | null;
          is_demo: boolean;
        }>(
          sql`select status, company_id, is_demo from users where id = ${userId}::uuid for update`,
        );
        const me = user.rows[0];
        if (!me) throw ApiError.notFound();
        const limits = await this.limits(tx);
        const existing = await tx.execute<{ source: string; effective_at: Date }>(sql`
          select source, effective_at from excluded_companies
           where user_id = ${userId}::uuid and company_id = ${companyId}::uuid`);
        const effective = existing.rows[0];
        const pending = await tx.execute<{ id: string; operation: 'add' | 'remove' }>(sql`
          select id, operation from excluded_company_changes
           where user_id = ${userId}::uuid and company_id = ${companyId}::uuid and status = 'pending'`);
        const open = pending.rows[0];
        if (operation === 'add') await this.assertAdmissible(tx, me, companyId);
        // In approvazione le scelte valgono subito e non contano nei limiti (D166)
        if (me.status === 'pending_approval') {
          if (open) {
            await tx.execute(sql`
              update excluded_company_changes set status = 'cancelled', closed_at = now()
               where id = ${open.id}::uuid`);
          }
          if (operation === 'add') {
            if (effective) return { status: 'unchanged' as const, latestAt: null };
            await this.assertBelowMax(tx, userId, limits.max);
            await tx.execute(sql`
              insert into excluded_companies (user_id, company_id, source)
              values (${userId}::uuid, ${companyId}::uuid, 'approval')`);
          } else {
            if (!effective) return { status: 'unchanged' as const, latestAt: null };
            await tx.execute(sql`
              delete from excluded_companies
               where user_id = ${userId}::uuid and company_id = ${companyId}::uuid`);
          }
          return { status: 'applied' as const, latestAt: null };
        }
        // La richiesta opposta a una modifica in attesa la annulla, senza contare (D39)
        if (open && open.operation !== operation) {
          await tx.execute(sql`
            update excluded_company_changes set status = 'cancelled', closed_at = now()
             where id = ${open.id}::uuid`);
          return { status: 'cancelled' as const, latestAt: null };
        }
        if (open) {
          const latest = await tx.execute<{ latest_at: Date }>(sql`
            select requested_at + make_interval(hours => ${LATEST_HOURS}) as latest_at
              from excluded_company_changes where id = ${open.id}::uuid`);
          return { status: 'pending' as const, latestAt: asDate(latest.rows[0]!.latest_at) };
        }
        if (operation === 'add' && effective)
          return { status: 'unchanged' as const, latestAt: null };
        if (operation === 'remove' && !effective) {
          throw ApiError.notFound();
        }
        if (operation === 'add') await this.assertBelowMax(tx, userId, limits.max);
        if (
          operation === 'remove' &&
          effective &&
          effective.source !== 'company_change' &&
          new Date(effective.effective_at).getTime() > Date.now() - limits.minDays * 86_400_000
        ) {
          throw new ApiError(422, 'excluded.removableFrom', {
            date: new Date(
              new Date(effective.effective_at).getTime() + limits.minDays * 86_400_000,
            ),
          });
        }
        const usage = await this.usage(userId, tx, limits);
        if (usage.remaining <= 0) {
          throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'excluded.changeLimit', {
            date: usage.changeableAt,
          });
        }
        const delay = randomInt(DELAY_SECONDS.min, DELAY_SECONDS.max + 1);
        const inserted = await tx.execute<{ latest_at: Date }>(sql`
          insert into excluded_company_changes (user_id, company_id, operation, requested_at, effective_at)
          values (${userId}::uuid, ${companyId}::uuid, ${operation}::exclusion_operation, now(),
                  now() + make_interval(secs => ${delay}))
          returning requested_at + make_interval(hours => ${LATEST_HOURS}) as latest_at`);
        return { status: 'pending' as const, latestAt: asDate(inserted.rows[0]!.latest_at) };
      });
    } catch (error) {
      // Trigger come ultima difesa (RC-40, RC-69, RC-124): risposte neutre
      if (pgErrorCode(error) === 'SSC05') throw new ApiError(422, 'excludedCompanies.invalid');
      if (pgErrorCode(error) === '22P02') throw ApiError.notFound();
      throw error;
    }
  }

  /** Azienda attiva, dello stesso tipo e diversa dalla propria (D158, D175, RC-40). */
  private async assertAdmissible(
    tx: Executor,
    me: { company_id: string | null; is_demo: boolean },
    companyId: string,
  ): Promise<void> {
    const company = await tx.execute<{ ok: boolean }>(sql`
      select (status = 'active' and is_demo = ${me.is_demo}
              and id is distinct from ${me.company_id}::uuid) as ok
        from companies where id = ${companyId}::uuid`);
    if (company.rows[0]?.ok !== true) throw new ApiError(422, 'excludedCompanies.invalid');
  }

  private async assertBelowMax(tx: Executor, userId: string, max: number): Promise<void> {
    const total = await tx.execute<{ total: number }>(
      sql`select excluded_companies_total(${userId}::uuid) as total`,
    );
    if ((total.rows[0]?.total ?? 0) >= max) throw new ApiError(422, 'excluded.error.max');
  }

  private async limits(tx: Executor) {
    return {
      max: await this.parameters.int('excluded_companies.max', 15, tx),
      maxChanges: await this.parameters.int('excluded_companies.max_changes', 5, tx),
      periodDays: await this.parameters.int('excluded_companies.period_days', 30, tx),
      minDays: await this.parameters.int('excluded_companies.min_days_before_removal', 7, tx),
    };
  }

  /** Modifiche non annullate negli ultimi 30 giorni (D39): rimaste e data da cui riprovare. */
  private async usage(
    userId: string,
    tx: Executor,
    limits: { maxChanges: number; periodDays: number },
  ): Promise<{ remaining: number; changeableAt: Date | null }> {
    const rows = await tx.execute<{ requested_at: Date | string }>(sql`
      select requested_at from excluded_company_changes
       where user_id = ${userId}::uuid and status <> 'cancelled'
         and requested_at > now() - make_interval(days => ${limits.periodDays})
       order by requested_at desc`);
    const used = rows.rows.length;
    const changeableAt =
      used >= limits.maxChanges
        ? new Date(
            new Date(rows.rows[limits.maxChanges - 1]!.requested_at).getTime() +
              limits.periodDays * 86_400_000,
          )
        : null;
    return { remaining: Math.max(0, limits.maxChanges - used), changeableAt };
  }
}
