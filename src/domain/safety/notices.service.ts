import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { teamAlerts, userNotices } from '../../infra/database/schema-safety';

/** Modelli degli avvisi email all'utente (testi in `src/infra/email/proposed-email-texts.ts`). */
export type NoticeTemplate =
  | 'sanction.decided'
  | 'sanction.revoked'
  | 'sanction.ended'
  | 'appeal.decided'
  | 'age_verification.requested'
  | 'approval.rejected'
  | 'approval.blocked'
  | 'approval.deletion_soon'
  | 'company_removal.started'
  | 'company_removal.cancelled'
  | 'reverification.started';

/**
 * Avvisi all'utente e al team, scritti nella transazione dell'azione: l'API di amministrazione
 * non legge mai l'email personale (D90); il processo `send-notices` la ricava e invia un testo
 * neutro (D67, D69, D101). Gli avvisi al team contengono solo conteggi.
 */
@Injectable()
export class NoticesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async toUser(
    userId: string,
    template: NoticeTemplate,
    params: Record<string, string | number | boolean | null> = {},
    tx: Executor = this.db,
  ): Promise<void> {
    await tx.insert(userNotices).values({ userId, template, params });
  }

  async toTeam(
    kind: string,
    counts: Record<string, number>,
    tx: Executor = this.db,
  ): Promise<void> {
    await tx.insert(teamAlerts).values({ kind, counts });
  }
}
