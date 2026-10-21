import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { accountEmails } from '../../infra/email/account-email-texts';
import { ApiError } from '../../infra/http/api-error';
import { OBJECT_STORAGE, ObjectStorage } from '../../infra/storage/object-storage';
import { ParametersService } from '../parameters/parameters.service';
import { PhotosService } from '../photos/photos.service';
import { AccountMailer } from './account-mailer';

export type DeletionSource = 'user' | 'consent' | 'web';

export interface DeletionState {
  deletionRequestedAt: Date;
  deletionFinalAt: Date;
  /** La cancellazione viene dalla revoca del consenso art. 9 (D33, D83). */
  consentRevoked: boolean;
}

/**
 * Cancellazione dell'account (D19, D33, D82, D83, D98, D112): richiesta con 7 giorni di
 * ripensamento (account nascosto, non uno stato nuovo), annullamento, revoca del consenso art. 9
 * con lo stesso percorso, cancellazione definitiva con `delete_account` e pulizia dell'archivio.
 * La revoca dei token di Apple e Google parte solo alla cancellazione definitiva (D233): la coda
 * la scrive `delete_account`.
 */
/** Chiavi dei file di un account nell'archivio. */
export interface AccountFiles {
  photos: string[];
  exports: string[];
}

@Injectable()
export class AccountLifecycleService {
  private readonly logger = new Logger(AccountLifecycleService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly photos: PhotosService,
    private readonly parameters: ParametersService,
    private readonly mailer: AccountMailer,
  ) {}

  /**
   * Avvia il ripensamento: `deletion_requested_at` e `deletion_final_at` (più 7 giorni). Con la
   * revoca del consenso, nella stessa transazione `consents.revoked_at` (D33). Idempotente: una
   * cancellazione già in corso mantiene la sua data.
   */
  async requestDeletion(
    userId: string,
    source: DeletionSource,
    tx?: Executor,
  ): Promise<DeletionState> {
    const run = async (executor: Executor): Promise<DeletionState> => {
      const days = await this.parameters.int('deletion.grace_days', 7, executor);
      const user = await executor.execute<{ status: string }>(
        sql`select status from users where id = ${userId}::uuid for update`,
      );
      if (!user.rows[0] || user.rows[0].status === 'deleted') throw ApiError.notFound();
      if (source === 'consent') {
        await executor.execute(sql`
          update consents set revoked_at = now()
           where user_id = ${userId}::uuid and type = 'art9' and revoked_at is null`);
      }
      await executor.execute(sql`
        update users set deletion_requested_at = coalesce(deletion_requested_at, now()),
               deletion_final_at = coalesce(deletion_final_at, now() + make_interval(days => ${days}))
         where id = ${userId}::uuid`);
      return this.state(userId, executor);
    };
    const state = tx ? await run(tx) : await this.db.transaction(run);
    if (!tx)
      await this.mailer.toUser(userId, accountEmails.deletionRequested(state.deletionFinalAt));
    return state;
  }

  /** Avviso della cancellazione in programma, dopo il commit della richiesta. */
  async notifyDeletionRequested(userId: string, state: DeletionState): Promise<void> {
    await this.mailer.toUser(userId, accountEmails.deletionRequested(state.deletionFinalAt));
  }

  /**
   * Annulla durante i 7 giorni: tutto torna com'era (D83). Dopo una revoca del consenso il
   * consenso si dà di nuovo con una riga nuova, con la stessa versione del testo, così la prova
   * della revoca resta [Proposta, da validare con il legale].
   */
  async cancelDeletion(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = await tx.execute<{ requested: Date | null }>(sql`
        select deletion_requested_at as requested from users where id = ${userId}::uuid for update`);
      if (!user.rows[0]?.requested) throw ApiError.conflict('deletion.notRequested');
      await tx.execute(sql`
        insert into consents (user_id, type, text_version)
        select ${userId}::uuid, 'art9', c.text_version from consents c
         where c.user_id = ${userId}::uuid and c.type = 'art9'
           and not exists (select 1 from consents a where a.user_id = ${userId}::uuid
                              and a.type = 'art9' and a.revoked_at is null)
         order by c.given_at desc limit 1`);
      await tx.execute(sql`
        update users set deletion_requested_at = null, deletion_final_at = null
         where id = ${userId}::uuid`);
    });
  }

  async state(userId: string, tx: Executor = this.db): Promise<DeletionState> {
    const result = await tx.execute<{
      requested: Date;
      final: Date;
      revoked: boolean;
    }>(sql`
      select x.deletion_requested_at as requested, x.deletion_final_at as final,
             not exists (select 1 from consents c where c.user_id = x.id and c.type = 'art9'
                           and c.revoked_at is null)
             and exists (select 1 from consents c where c.user_id = x.id and c.type = 'art9') as revoked
        from users x where x.id = ${userId}::uuid`);
    const row = result.rows[0];
    if (!row?.requested) throw ApiError.conflict('deletion.notRequested');
    return {
      deletionRequestedAt: new Date(row.requested),
      deletionFinalAt: new Date(row.final),
      consentRevoked: row.revoked,
    };
  }

  /**
   * Cancellazione definitiva (D98, D112): avviso neutro all'email personale letto prima,
   * `delete_account` (match chiusi, messaggi propri cancellati, prove del consenso senza legame,
   * coda della revoca dei token), poi i file nell'archivio. Ripetibile.
   */
  async deleteNow(userId: string, notify = true): Promise<void> {
    const address = notify ? await this.mailer.personalEmail(userId) : null;
    const files = await this.filesOf(userId);
    await this.db.execute(sql`select delete_account(${userId}::uuid)`);
    await this.removeFiles(files);
    if (address) await this.mailer.toAddress(address, accountEmails.accountDeleted());
  }

  /**
   * File dell'account nell'archivio (foto ed esportazioni), da leggere prima di `delete_account`
   * e da cancellare con `removeFiles` dopo il commit: usato anche dal Supporto e dalla rimozione
   * di un'azienda (D85, D185), così non resta nulla.
   */
  async filesOf(userId: string, tx: Executor = this.db): Promise<AccountFiles> {
    const files = await tx.execute<{ storage_key: string; kind: string }>(sql`
      select storage_key, 'photo' as kind from photos where user_id = ${userId}::uuid
      union all
      select storage_key, 'export' from data_exports
       where user_id = ${userId}::uuid and storage_key is not null`);
    return {
      photos: files.rows.filter((file) => file.kind === 'photo').map((file) => file.storage_key),
      exports: files.rows.filter((file) => file.kind === 'export').map((file) => file.storage_key),
    };
  }

  async removeFiles(files: AccountFiles): Promise<void> {
    await this.photos.deleteFiles(files.photos);
    for (const key of files.exports) await this.storage.delete(key);
  }

  /** Processo giornaliero `complete-deletions`: fine dei 7 giorni di ripensamento. */
  async completeDueDeletions(): Promise<number> {
    return this.deleteAll(sql`select id from users where deletion_final_at <= now()`);
  }

  /** Processo giornaliero `delete-suspended-accounts`: sospesi da 30 giorni (D19). */
  async deleteExpiredSuspensions(): Promise<number> {
    return this.deleteAll(
      sql`select id from users where status = 'suspended' and deletion_scheduled_at <= now()`,
    );
  }

  /** Processo giornaliero `clean-registrations`: registrazioni iniziate da più di 7 giorni (D82). */
  async cleanAbandonedRegistrations(): Promise<number> {
    return this.deleteAll(
      sql`select id from users where status = 'registering' and created_at < now() - interval '7 days'`,
      false,
    );
  }

  private async deleteAll(query: ReturnType<typeof sql>, notify = true): Promise<number> {
    const rows = await this.db.execute<{ id: string }>(query);
    let count = 0;
    for (const { id } of rows.rows) {
      try {
        await this.deleteNow(id, notify);
        count++;
      } catch {
        this.logger.warn(
          'Cancellazione definitiva non riuscita: nuovo tentativo al passaggio dopo',
        );
      }
    }
    return count;
  }
}
