import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { AccountEmail } from '../../infra/email/account-email-texts';
import { EMAIL_SENDER, EmailSender } from '../../infra/email/email-sender';

/**
 * Avvisi di account e sicurezza all'email personale (D67), dal mittente con il nome dell'app
 * (D101); mai all'email aziendale, che potrebbe leggere il datore di lavoro (D9). Un invio non
 * riuscito non annulla l'operazione già confermata: si registra senza dati personali.
 */
@Injectable()
export class AccountMailer {
  private readonly logger = new Logger(AccountMailer.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
  ) {}

  /** Email personale attiva dell'account, letta prima di una cancellazione. */
  async personalEmail(userId: string, tx: Executor = this.db): Promise<string | null> {
    const result = await tx.execute<{ email: string }>(sql`
      select email from personal_identities where user_id = ${userId}::uuid and revoked_at is null`);
    return result.rows[0]?.email ?? null;
  }

  async toUser(userId: string, message: AccountEmail): Promise<void> {
    const address = await this.personalEmail(userId);
    if (address) await this.toAddress(address, message);
  }

  async toAddress(address: string, message: AccountEmail): Promise<void> {
    try {
      await this.email.send({ to: address, from: 'project', ...message });
    } catch {
      this.logger.warn('Avviso di account non inviato');
    }
  }
}
