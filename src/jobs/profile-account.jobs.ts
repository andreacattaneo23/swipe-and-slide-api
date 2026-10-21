import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../infra/database/database';
import { ACCOUNT_NOTIFIER, AccountNotifier } from '../domain/account/account-notifier';
import { AccountLifecycleService } from '../domain/account/account-lifecycle.service';
import { DataExportsService } from '../domain/account/data-exports.service';
import { BlocksService } from '../domain/blocks/blocks.service';
import { ExcludedCompaniesService } from '../domain/excluded-companies/excluded-companies.service';
import { ParametersService } from '../domain/parameters/parameters.service';
import { PhotosService } from '../domain/photos/photos.service';
import { TripsService } from '../domain/trips/trips.service';
import { WorkIdentityService } from '../domain/work-identity/work-identity.service';
import { JobSource, SourceJob } from './job';

/**
 * Processi pianificati del profilo e dell'account (architettura, "Processi pianificati"): ogni
 * passo è un aggiornamento condizionato, quindi rieseguirlo non produce effetti doppi. Nessuno
 * applica la regola core né approva nulla (D144).
 */
@Injectable()
export class ProfileAccountJobs implements JobSource {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly workIdentity: WorkIdentityService,
    private readonly lifecycle: AccountLifecycleService,
    private readonly excluded: ExcludedCompaniesService,
    private readonly trips: TripsService,
    private readonly blocks: BlocksService,
    private readonly exports: DataExportsService,
    private readonly photos: PhotosService,
    private readonly parameters: ParametersService,
    @Optional() @Inject(ACCOUNT_NOTIFIER) private readonly notifier?: AccountNotifier,
  ) {}

  daily(): SourceJob[] {
    return [
      { name: 'start-reverifications', run: () => this.workIdentity.startDueReverifications() },
      { name: 'suspend-expired-reverifications', run: () => this.workIdentity.suspendExpired() },
      { name: 'notify-deletions', run: () => this.workIdentity.notifyDeletions() },
      { name: 'delete-suspended-accounts', run: () => this.lifecycle.deleteExpiredSuspensions() },
      { name: 'complete-deletions', run: () => this.lifecycle.completeDueDeletions() },
      { name: 'clean-registrations', run: () => this.lifecycle.cleanAbandonedRegistrations() },
      { name: 'delete-past-trips', run: () => this.trips.deletePast() },
      { name: 'clean-unblocked-blocks', run: () => this.blocks.cleanUnblocked() },
      { name: 'clean-data-exports', run: () => this.exports.cleanExpired() },
      { name: 'clean-excluded-company-changes', run: () => this.excluded.cleanClosed() },
      { name: 'clean-rate-limit-events', run: () => this.cleanRateLimitEvents() },
    ];
  }

  hourly(): SourceJob[] {
    return [
      { name: 'apply-excluded-company-changes', run: () => this.excluded.applyDue() },
      { name: 'prepare-data-exports', run: () => this.exports.prepareDue() },
      { name: 'ooo-reminders', run: () => this.oooReminders() },
      { name: 'retry-photo-checks', run: () => this.retryPhotoChecks() },
    ];
  }

  /**
   * `ooo-reminders` (D81, D114): modalità OOO attiva da 30 giorni, una volta sola. Segna il
   * promemoria e chiede la push `ooo_reminder` al servizio delle notifiche (`ACCOUNT_NOTIFIER`),
   * che applica preferenze e "Modalità in riunione".
   */
  private async oooReminders(): Promise<number> {
    const days = await this.parameters.int('ooo.reminder_days', 30);
    const result = await this.db.execute<{ user_id: string }>(sql`
      update profiles set ooo_reminder_at = now()
       where ooo_since is not null and ooo_reminder_at is null
         and ooo_since <= now() - make_interval(days => ${days})
      returning user_id`);
    for (const row of result.rows) await this.notifier?.notify(row.user_id, 'ooo_reminder');
    return result.rows.length;
  }

  /** `retry-photo-checks`: foto rimaste `checking` per un errore del servizio di controllo. */
  private async retryPhotoChecks(): Promise<number> {
    const rows = await this.db.execute<{ id: string; user_id: string }>(sql`
      select id, user_id from photos where status = 'checking'
         and uploaded_at < now() - interval '10 minutes' limit 50`);
    for (const row of rows.rows) await this.photos.check(row.user_id, row.id);
    return rows.rows.length;
  }

  /** Parte di `clean-counters`: eventi dei limiti di frequenza oltre il periodo più lungo. */
  private async cleanRateLimitEvents(): Promise<number> {
    const result = await this.db.execute(
      sql`delete from rate_limit_events where occurred_at < now() - interval '90 days'`,
    );
    return result.rowCount ?? 0;
  }
}
