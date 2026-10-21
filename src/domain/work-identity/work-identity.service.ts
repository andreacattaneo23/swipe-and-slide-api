import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor, pgErrorCode } from '../../infra/database/database';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { accountEmails } from '../../infra/email/account-email-texts';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { AccountMailer } from '../account/account-mailer';
import { ACCOUNT_NOTIFIER, AccountNotifier } from '../account/account-notifier';
import {
  type ActiveMatch,
  activeMatchesOf,
  publishClosedMatches,
} from '../realtime/match-closures';
import { RealtimePublisher } from '../realtime/realtime-publisher';
import { CompaniesService } from '../companies/companies.service';
import { isDisposable, isPersonalProvider, normalizeEmail } from '../email/email-address';
import { ExcludedCompaniesService } from '../excluded-companies/excluded-companies.service';
import { OtpService } from '../otp/otp.service';
import { ParametersService } from '../parameters/parameters.service';

/** Da dove parte il collegamento di una nuova email aziendale. */
export type WorkEmailFlow = 'company_change' | 'restore';

export interface WorkEmailResult {
  /** `sameCompany`: aggiornato solo l'indirizzo; `changed`: nuova azienda con tutti gli effetti. */
  result: 'sameCompany' | 'changed';
  company: { id: string; name: string };
  /** L'Open space era attivo ed è stato spento: l'app chiede se riattivarlo (D197). */
  openSpacePrompt: boolean;
  /** L'azienda lasciata è entrata nelle aziende escluse (D176). */
  leftCompanyExcluded: boolean;
  /** La nuova azienda era tra le aziende escluse ed è uscita dall'elenco (D158). */
  newCompanyUnexcluded: boolean;
}

type UserRow = {
  status: string;
  company_id: string | null;
  is_demo: boolean;
  reverification_reason: string | null;
  open_space: boolean;
};

/**
 * Identità aziendale (D9, D19, D20, D82, D176): cambio azienda, ri-verifica periodica,
 * ripristino di un account in sospeso. Tutti gli effetti di un cambio in un'unica transazione,
 * subito, senza il ritardo delle aziende escluse (D36): email storica, nuova email attiva,
 * azienda lasciata tra le aziende escluse, nuova azienda tolta, Open space spento con la domanda,
 * revoca tra i nuovi colleghi (`realign_users`), riga di `company_changes`. Nessuna nuova
 * approvazione (D143). Mai un'email alla vecchia email aziendale.
 */
@Injectable()
export class WorkIdentityService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly companies: CompaniesService,
    private readonly otp: OtpService,
    private readonly coreRule: CoreRuleService,
    private readonly excluded: ExcludedCompaniesService,
    private readonly parameters: ParametersService,
    private readonly mailer: AccountMailer,
    @Optional() @Inject(ACCOUNT_NOTIFIER) private readonly notifier?: AccountNotifier,
    @Optional() private readonly realtime?: RealtimePublisher,
  ) {}

  /**
   * Nuova email aziendale, prima parte: stessi controlli della registrazione **prima** di
   * qualsiasi invio (dominio dell'elenco, niente provider personali né usa e getta), limite di un
   * vero cambio ogni 30 giorni (D20); poi il codice dal mittente neutro (D101).
   */
  async requestNewWorkEmailCode(
    userId: string,
    input: string,
    ip: string,
    flow: WorkEmailFlow,
  ): Promise<void> {
    const user = await this.user(userId, this.db);
    this.assertFlow(user, flow);
    const { email, companyId } = await this.listedEmail(input, user.is_demo);
    if (companyId !== user.company_id && this.source(user, flow) === 'user') {
      await this.assertChangeAllowed(userId, this.db);
    }
    await this.otp.issue({ email, purpose: 'company_change', from: 'neutral', ip, userId });
  }

  /** Nuova email aziendale, verifica: solo ora impronte bloccate ed email già usata (D100). */
  async verifyNewWorkEmail(
    userId: string,
    input: { email: string; code: string; declarationVersion: string },
    flow: WorkEmailFlow,
  ): Promise<WorkEmailResult> {
    const before = await this.user(userId, this.db);
    this.assertFlow(before, flow);
    const { email, domain } = await this.listedEmail(input.email, before.is_demo);
    await this.otp.verifyOrThrow(email, 'company_change', input.code);
    const hash = this.crypto.hash('email', email);
    if (await this.isBlocked(hash)) throw ApiError.badRequest(ErrorCode.registrationBlocked);
    let result: WorkEmailResult;
    let activeBefore: ActiveMatch[] = [];
    try {
      result = await this.db.transaction(async (tx) => {
        const user = await this.user(userId, tx, true);
        this.assertFlow(user, flow);
        // Match attivi prima del riallineamento, per avvisare in tempo reale di quelli chiusi
        activeBefore = await activeMatchesOf(tx, [userId]);
        const inUse = await tx.execute<{ other: boolean; own_active: boolean }>(sql`
          select exists (select 1 from work_emails where email_hash = ${hash} and user_id <> ${userId}::uuid)
              or exists (select 1 from personal_identities where email_hash = ${hash}) as other,
                 exists (select 1 from work_emails where email_hash = ${hash}
                           and user_id = ${userId}::uuid and status = 'active') as own_active`);
        if (inUse.rows[0]?.other) throw ApiError.conflict('companyChange.error.inUse');
        if (inUse.rows[0]?.own_active) throw ApiError.conflict('companyChange.error.notDifferent');
        // Il dominio si ricontrolla nel database dentro la transazione (D229)
        const company = await this.companies.findActiveByDomain(domain, tx);
        if (!company || company.isDemo !== user.is_demo) {
          throw ApiError.badRequest(ErrorCode.domainNotListed);
        }
        const source = this.source(user, flow);
        const changed = company.id !== user.company_id;
        if (changed && source === 'user') await this.assertChangeAllowed(userId, tx);
        // Un indirizzo già usato in passato dallo stesso account torna attivo (impronta unica)
        await tx.execute(sql`
          delete from work_emails where user_id = ${userId}::uuid and email_hash = ${hash}`);
        await tx.execute(sql`
          update work_emails set status = 'historical', email = null
           where user_id = ${userId}::uuid and status = 'active'`);
        const days = await this.parameters.int('reverification.days', 90, tx);
        await tx.execute(sql`
          insert into work_emails (user_id, company_id, domain, email, email_hash, status, verified_at,
                                   next_reverification_at)
          values (${userId}::uuid, ${company.id}::uuid, ${domain}, ${email}, ${hash}, 'active', now(),
                  now() + make_interval(days => ${days}))`);
        await tx.execute(sql`
          update users set company_id = ${company.id}::uuid,
                 status = case when status in ('reverifying', 'suspended') then 'active' else status end,
                 reverification_due_at = null, reverification_reason = null,
                 deletion_scheduled_at = case when status = 'suspended' then null else deletion_scheduled_at end,
                 deletion_notice_at = null
           where id = ${userId}::uuid`);
        // Dopo l'azienda nuova: l'azienda lasciata non è più quella attuale (trigger SSC05)
        let effects = { leftCompanyExcluded: false, newCompanyUnexcluded: false };
        if (changed) {
          effects = await this.excluded.onCompanyChange(tx, userId, user.company_id, company.id);
          if (effects.leftCompanyExcluded || effects.newCompanyUnexcluded) {
            await tx.execute(
              sql`update users set excluded_companies_notice_at = now() where id = ${userId}::uuid`,
            );
          }
        }
        await tx.execute(sql`
          insert into consents (user_id, type, text_version)
          values (${userId}::uuid, 'p7_declaration', ${input.declarationVersion})`);
        let openSpacePrompt = false;
        if (changed) {
          // Colleghi nuovi: l'Open space torna spento prima del riallineamento (D197)
          openSpacePrompt = user.open_space;
          await this.coreRule.setOpenSpace(userId, false, 'company_change', null, tx);
        }
        // Sempre il riallineamento, anche al ripristino con la stessa azienda (D41, D59)
        const realigned = await this.coreRule.realign([userId], tx);
        if (changed) {
          await tx.execute(sql`
            insert into company_changes (user_id, from_company_id, to_company_id, source,
                                         matches_revoked, likes_deleted, left_company_excluded,
                                         new_company_unexcluded)
            values (${userId}::uuid, ${user.company_id}::uuid, ${company.id}::uuid,
                    ${source}::company_change_source, ${realigned.matchesRevoked},
                    ${realigned.likesDeleted}, ${effects.leftCompanyExcluded},
                    ${effects.newCompanyUnexcluded})`);
        }
        await resyncSessionScope(tx, userId, 'full');
        const name = await tx.execute<{ name: string }>(
          sql`select name from companies where id = ${company.id}::uuid`,
        );
        return {
          result: changed ? ('changed' as const) : ('sameCompany' as const),
          company: { id: company.id, name: name.rows[0]!.name },
          openSpacePrompt,
          ...effects,
        };
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505') throw ApiError.conflict('companyChange.error.inUse');
      throw error;
    }
    // Dopo il commit: i match revocati con i nuovi colleghi spariscono subito dalle app (D9, D59)
    if (this.realtime) await publishClosedMatches(this.db, this.realtime, activeBefore);
    await this.mailer.toUser(userId, accountEmails.workEmailUpdated());
    return result;
  }

  /**
   * Ri-verifica (D20, D72, D82, P5) o ripristino con la stessa email: codice all'email aziendale
   * attiva dal mittente neutro, dopo un nuovo controllo del dominio. Con il dominio rimosso la
   * stessa email non basta più (P14).
   */
  async requestReverificationCode(userId: string, ip: string): Promise<void> {
    const active = await this.activeWorkEmail(userId, this.db);
    await this.otp.issue({
      email: active.email,
      purpose: 'reverification',
      from: 'neutral',
      ip,
      userId,
    });
  }

  async verifyReverification(userId: string, code: string): Promise<void> {
    const active = await this.activeWorkEmail(userId, this.db);
    await this.otp.verifyOrThrow(active.email, 'reverification', code);
    await this.db.transaction(async (tx) => {
      await this.user(userId, tx, true);
      const again = await this.activeWorkEmail(userId, tx);
      const days = await this.parameters.int('reverification.days', 90, tx);
      await tx.execute(sql`
        update work_emails set verified_at = now(), next_reverification_at = now() + make_interval(days => ${days}),
               bounced_at = null
         where id = ${again.id}::uuid`);
      await tx.execute(sql`
        update users set status = case when status in ('reverifying', 'suspended') then 'active' else status end,
               reverification_due_at = null, reverification_reason = null,
               deletion_scheduled_at = case when status = 'suspended' then null else deletion_scheduled_at end,
               deletion_notice_at = null
         where id = ${userId}::uuid`);
      // Ripristino: si revocano solo i match senza messaggi con chi nel frattempo è diventato
      // collega (D41 rivista da D58 e D59); l'azienda non cambia, l'Open space resta com'era
      await this.coreRule.realign([userId], tx);
      await resyncSessionScope(tx, userId, 'full');
    });
  }

  /**
   * Processo giornaliero `start-reverifications`: email aziendali attive scadute (90 giorni),
   * utente `reverifying` con 7 giorni di tempo e avviso all'email personale (P5).
   */
  async startDueReverifications(): Promise<number> {
    const grace = await this.parameters.int('reverification.grace_days', 7);
    const started = await this.db.execute<{ id: string; due: Date }>(sql`
      update users x set status = 'reverifying', reverification_reason = 'expiry',
             reverification_due_at = now() + make_interval(days => ${grace})
        from work_emails w
       where w.user_id = x.id and w.status = 'active' and w.next_reverification_at <= now()
         and x.status = 'active' and not x.is_demo
      returning x.id, x.reverification_due_at as due`);
    for (const row of started.rows) {
      await this.mailer.toUser(row.id, accountEmails.reverificationStarted(new Date(row.due)));
      await this.notifier?.notify(row.id, 'reverification');
    }
    return started.rowCount ?? 0;
  }

  /**
   * Processo giornaliero `suspend-expired-reverifications`: ri-verifica non completata entro 7
   * giorni, account in sospeso con la cancellazione a 30 giorni (D19, P6, RC-25). Match e chat
   * restano congelati, non revocati (D41); le sessioni passano a `restore`.
   */
  async suspendExpired(): Promise<number> {
    const days = await this.parameters.int('suspension.deletion_days', 30);
    const ids = await this.db.execute<{ id: string }>(sql`
      select id from users where status = 'reverifying' and reverification_due_at <= now()`);
    let count = 0;
    for (const { id } of ids.rows) {
      const deletion = await this.db.transaction(async (tx) => {
        const updated = await tx.execute<{ deletion: Date }>(sql`
          update users set status = 'suspended',
                 deletion_scheduled_at = now() + make_interval(days => ${days}), deletion_notice_at = null
           where id = ${id}::uuid and status = 'reverifying' and reverification_due_at <= now()
          returning deletion_scheduled_at as deletion`);
        if (!updated.rows[0]) return null;
        await resyncSessionScope(tx, id, 'restore');
        return new Date(updated.rows[0].deletion);
      });
      if (deletion) {
        count++;
        await this.mailer.toUser(id, accountEmails.suspended(deletion));
      }
    }
    return count;
  }

  /** Processo giornaliero `notify-deletions`: sospesi a 7 giorni dalla cancellazione (P6). */
  async notifyDeletions(): Promise<number> {
    const rows = await this.db.execute<{ id: string; deletion: Date }>(sql`
      update users set deletion_notice_at = now()
       where status = 'suspended' and deletion_notice_at is null
         and deletion_scheduled_at <= now() + interval '7 days'
      returning id, deletion_scheduled_at as deletion`);
    for (const row of rows.rows) {
      await this.mailer.toUser(row.id, accountEmails.deletionSoon(new Date(row.deletion)));
    }
    return rows.rowCount ?? 0;
  }

  private assertFlow(user: UserRow, flow: WorkEmailFlow): void {
    const allowed =
      flow === 'restore'
        ? user.status === 'suspended'
        : ['active', 'reverifying'].includes(user.status);
    if (!allowed) throw ApiError.forbidden();
  }

  /** Origine del cambio (D82): i ripristini e il dominio rimosso non contano per il limite. */
  private source(user: UserRow, flow: WorkEmailFlow): 'user' | 'restore' | 'domain_removed' {
    if (flow === 'restore') return 'restore';
    if (user.reverification_reason === 'domain_removed') return 'domain_removed';
    return 'user';
  }

  /** Al massimo un vero cambio di azienda ogni 30 giorni (D20, RC-20). */
  private async assertChangeAllowed(userId: string, tx: Executor): Promise<void> {
    const days = await this.parameters.int('company_change.min_days', 30, tx);
    const recent = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from company_changes
       where user_id = ${userId}::uuid and source = 'user'
         and changed_at > now() - make_interval(days => ${days})`);
    if ((recent.rows[0]?.n ?? 0) > 0) throw ApiError.conflict('companyChange.error.limit');
  }

  private async listedEmail(
    input: string,
    isDemo: boolean,
  ): Promise<{ email: string; domain: string; companyId: string }> {
    const email = normalizeEmail(input);
    if (!email) throw ApiError.badRequest(ErrorCode.validation);
    if (isPersonalProvider(email.domain) || isDisposable(email.domain)) {
      throw ApiError.badRequest(ErrorCode.workEmailPersonal);
    }
    const company = await this.companies.findActiveByDomain(email.domain);
    if (!company || company.isDemo !== isDemo) throw ApiError.badRequest(ErrorCode.domainNotListed);
    return { email: email.email, domain: email.domain, companyId: company.id };
  }

  private async activeWorkEmail(
    userId: string,
    tx: Executor,
  ): Promise<{ id: string; email: string }> {
    const user = await this.user(userId, tx);
    if (!['active', 'reverifying', 'suspended'].includes(user.status)) throw ApiError.forbidden();
    const result = await tx.execute<{
      id: string;
      email: string;
      listed: boolean;
      due: Date | null;
    }>(sql`
      select w.id, w.email,
             exists (select 1 from company_domains d join companies z on z.id = d.company_id
                      where d.domain = w.domain and d.company_id = w.company_id and z.status = 'active') as listed,
             x.reverification_due_at as due
        from work_emails w join users x on x.id = w.user_id
       where w.user_id = ${userId}::uuid and w.status = 'active'`);
    const row = result.rows[0];
    if (!row) throw ApiError.forbidden();
    if (!row.listed || user.reverification_reason === 'domain_removed') {
      const left = row.due
        ? Math.max(0, Math.ceil((new Date(row.due).getTime() - Date.now()) / 86_400_000))
        : 0;
      throw ApiError.conflict('reverification.domainRemoved', { count: left });
    }
    return { id: row.id, email: row.email };
  }

  private async user(userId: string, tx: Executor, lock = false): Promise<UserRow> {
    const result = await tx.execute<UserRow>(
      lock
        ? sql`select status, company_id, is_demo, reverification_reason, open_space
                from users where id = ${userId}::uuid for update`
        : sql`select status, company_id, is_demo, reverification_reason, open_space
                from users where id = ${userId}::uuid`,
    );
    const row = result.rows[0];
    if (!row) throw ApiError.notFound();
    return row;
  }

  private async isBlocked(hash: string): Promise<boolean> {
    const result = await this.db.execute<{ blocked: boolean }>(sql`
      select exists (select 1 from blocked_hashes where hash = ${hash} and expires_at > now()) as blocked`);
    return result.rows[0]?.blocked === true;
  }
}

/**
 * Allinea l'ambito delle sessioni aperte allo stato dell'account: i token di accesso con
 * l'ambito di prima non valgono più alla richiesta successiva e il rinnovo ricalcola l'ambito.
 */
export async function resyncSessionScope(
  tx: Executor,
  userId: string,
  scope: 'full' | 'restore' | 'limited' | 'approval',
): Promise<void> {
  await tx.execute(sql`
    update sessions set scope = ${scope}::session_scope
     where user_id = ${userId}::uuid and revoked_at is null and expires_at > now()`);
}
