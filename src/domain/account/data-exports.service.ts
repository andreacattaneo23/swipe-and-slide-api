import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { asDate } from '../../infra/database/timestamps';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { DATABASE, Database } from '../../infra/database/database';
import { accountEmails } from '../../infra/email/account-email-texts';
import { ApiError } from '../../infra/http/api-error';
import {
  OBJECT_STORAGE,
  ObjectStorage,
  SIGNED_URL_SECONDS,
} from '../../infra/storage/object-storage';
import { ParametersService } from '../parameters/parameters.service';
import { photoKeys } from '../photos/photos.service';
import { ChatCryptoService } from '../chat-crypto/chat-crypto.service';
import { AccountMailer } from './account-mailer';

export interface DataExport {
  id: string;
  status: 'pending' | 'ready' | 'failed' | 'expired';
  requestedAt: Date;
  readyAt: Date | null;
  expiresAt: Date | null;
  /** URL firmato di pochi minuti, solo quando il file è pronto (D83). */
  downloadUrl: string | null;
}

type ExportRow = {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  requested_at: Date;
  ready_at: Date | null;
  expires_at: Date | null;
  storage_key: string | null;
};

/**
 * "Scarica i miei dati" (D83, art. 15 GDPR): una richiesta in corso e una ogni 7 giorni; il
 * processo orario prepara entro 48 ore un archivio ZIP con file JSON e le foto, disponibile 7
 * giorni con un URL firmato. Solo dati dell'utente: dei match data e identificativo, dei messaggi
 * solo quelli scritti dall'utente; mai dati, Open space o profili di altre persone (RC-128).
 */
@Injectable()
export class DataExportsService {
  private readonly logger = new Logger(DataExportsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly parameters: ParametersService,
    private readonly mailer: AccountMailer,
    private readonly chatCrypto: ChatCryptoService,
  ) {}

  async request(userId: string): Promise<DataExport> {
    const minDays = await this.parameters.int('data_exports.min_days', 7);
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
      const pending = await tx.execute<ExportRow>(sql`
        select * from data_exports where user_id = ${userId}::uuid and status = 'pending'`);
      if (pending.rows[0]) return pending.rows[0];
      const last = await tx.execute<{ requested_at: Date }>(sql`
        select requested_at from data_exports where user_id = ${userId}::uuid and status <> 'failed'
         order by requested_at desc limit 1`);
      const previous = last.rows[0]?.requested_at;
      if (previous && Date.now() - new Date(previous).getTime() < minDays * 86_400_000) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'dataExport.limit', {
          date: new Date(new Date(previous).getTime() + minDays * 86_400_000),
        });
      }
      const inserted = await tx.execute<ExportRow>(sql`
        insert into data_exports (user_id) values (${userId}::uuid) returning *`);
      return inserted.rows[0]!;
    });
    return this.describe(row);
  }

  async list(userId: string): Promise<DataExport[]> {
    const rows = await this.db.execute<ExportRow>(sql`
      select * from data_exports where user_id = ${userId}::uuid order by requested_at desc limit 5`);
    return Promise.all(rows.rows.map((row) => this.describe(row)));
  }

  async get(userId: string, exportId: string): Promise<DataExport> {
    const rows = await this.db.execute<ExportRow>(sql`
      select * from data_exports where id = ${exportId}::uuid and user_id = ${userId}::uuid`);
    if (!rows.rows[0]) throw ApiError.notFound();
    return this.describe(rows.rows[0]);
  }

  /** Processo orario `prepare-data-exports`. */
  async prepareDue(): Promise<number> {
    const due = await this.db.execute<{ id: string; user_id: string }>(sql`
      select id, user_id from data_exports where status = 'pending' and attempts < 5
       order by requested_at limit 20`);
    let ready = 0;
    for (const item of due.rows) {
      try {
        await this.prepare(item.id, item.user_id);
        ready++;
      } catch {
        this.logger.warn('Esportazione dei dati non preparata: nuovo tentativo');
        await this.db.execute(sql`
          update data_exports set attempts = attempts + 1,
                 status = case when attempts + 1 >= 5 then 'failed'::data_export_status else status end
           where id = ${item.id}::uuid`);
      }
    }
    return ready;
  }

  /** Processo giornaliero `clean-data-exports`: file scaduti e righe vecchie. */
  async cleanExpired(): Promise<number> {
    const expired = await this.db.execute<{ id: string; storage_key: string | null }>(sql`
      select id, storage_key from data_exports
       where (status = 'ready' and expires_at < now())
          or (status = 'failed' and requested_at < now() - interval '30 days')`);
    for (const row of expired.rows) {
      if (row.storage_key) await this.storage.delete(row.storage_key);
      await this.db.execute(sql`delete from data_exports where id = ${row.id}::uuid`);
    }
    return expired.rows.length;
  }

  private async prepare(exportId: string, userId: string): Promise<void> {
    const data = await this.collect(userId);
    const files: Record<string, Uint8Array> = {};
    for (const [name, value] of Object.entries(data.json)) {
      files[`${name}.json`] = strToU8(JSON.stringify(value, null, 2));
    }
    for (const [index, key] of data.photoKeys.entries()) {
      const body = await this.storage.get(photoKeys(key).large);
      if (body) files[`foto/foto-${index + 1}.jpg`] = new Uint8Array(body);
    }
    const zip = Buffer.from(zipSync(files, { level: 6 }));
    const storageKey = `exports/${randomBytes(16).toString('hex')}.zip`;
    await this.storage.put(storageKey, zip, 'application/zip');
    const retention = await this.parameters.int('data_exports.retention_days', 7);
    const updated = await this.db.execute<{ expires_at: Date }>(sql`
      update data_exports set status = 'ready', ready_at = now(), storage_key = ${storageKey},
             expires_at = now() + make_interval(days => ${retention})
       where id = ${exportId}::uuid and status = 'pending' returning expires_at`);
    if (!updated.rows[0]) {
      await this.storage.delete(storageKey);
      return;
    }
    await this.mailer.toUser(
      userId,
      accountEmails.dataExportReady(new Date(updated.rows[0].expires_at)),
    );
  }

  /** Dati dell'utente stesso, tabella per tabella (D83, RC-128, RC-159). */
  private async collect(
    userId: string,
  ): Promise<{ json: Record<string, unknown>; photoKeys: string[] }> {
    const q = async (query: ReturnType<typeof sql>) => (await this.db.execute(query)).rows;
    const id = sql`${userId}::uuid`;
    const photos = await q(sql`
      select storage_key, position, status, uploaded_at from photos where user_id = ${id}
       and status in ('approved', 'pending_approval', 'under_review') order by position`);
    const json: Record<string, unknown> = {
      account: await q(sql`
        select x.id, x.status, x.created_at, z.name as company, x.open_space, x.open_space_since,
               x.reverification_due_at, x.deletion_requested_at, x.deletion_final_at,
               x.work_email_sign_in
          from users x left join companies z on z.id = x.company_id where x.id = ${id}`),
      identita_personale: await q(sql`
        select provider, email, is_private_relay, created_at, last_sign_in_at
          from personal_identities where user_id = ${id}`),
      email_aziendali: await q(sql`
        select w.email, w.domain, z.name as company, w.status, w.verified_at, w.next_reverification_at
          from work_emails w left join companies z on z.id = w.company_id where w.user_id = ${id}`),
      cambi_azienda: await q(sql`
        select f.name as from_company, t.name as to_company, c.source, c.changed_at
          from company_changes c left join companies f on f.id = c.from_company_id
          left join companies t on t.id = c.to_company_id where c.user_id = ${id}`),
      profilo: await q(sql`
        select first_name, last_name, birth_date, gender, interested_in, looking_for, bio,
               practice_area, home_city_id, age_min, age_max, max_distance, show_calendar,
               read_receipts, ooo_since from profiles where user_id = ${id}`),
      interessi: await q(sql`select interest from user_interests where user_id = ${id}`),
      domande: await q(sql`select question, answer from profile_answers where user_id = ${id}`),
      foto: photos.map((photo) => ({ ...photo, storage_key: undefined })),
      trasferte: await q(sql`
        select city_id, start_date, end_date, created_at from trips where user_id = ${id}`),
      aziende_escluse: await q(sql`
        select z.name, e.source, e.effective_at from excluded_companies e
          join companies z on z.id = e.company_id where e.user_id = ${id}`),
      modifiche_aziende_escluse: await q(sql`
        select z.name, c.operation, c.requested_at, c.status, c.closed_at
          from excluded_company_changes c join companies z on z.id = c.company_id
         where c.user_id = ${id}`),
      open_space_storico: await q(sql`
        select enabled, changed_at, source, text_version from open_space_history
         where user_id = ${id} order by changed_at`),
      consensi: await q(sql`
        select type, text_version, given_at, revoked_at from consents where user_id = ${id}`),
      revisioni_profilo: await q(sql`
        select attempt, submitted_at, outcome, decided_at, reason, explanation
          from profile_reviews where user_id = ${id} order by attempt`),
      swipe: await q(sql`
        select type, created_at, offsite_id from swipes where from_user_id = ${id}`),
      match: await q(sql`
        select id, status, created_at, chat_started_at, closed_at from matches
         where ${id} in (user_a_id, user_b_id)`),
      // Messaggi scritti dall'utente, decifrati con la chiave del match (D183): solo i propri
      messaggi_scritti: await this.ownMessages(userId),
      persone_bloccate: await q(sql`
        select created_at, unblocked_at from blocks where from_user_id = ${id}`),
      offsite: await q(sql`
        select o.title, o.starts_at, a.joined_at, a.show_on_profile from offsite_attendees a
          join offsites o on o.id = a.offsite_id where a.user_id = ${id}`),
    };
    return { json, photoKeys: photos.map((photo) => String(photo.storage_key)) };
  }

  /** Messaggi scritti dall'utente con il testo decifrato; `null` se la chiave non c'è più. */
  private async ownMessages(
    userId: string,
  ): Promise<{ match_id: string; created_at: unknown; testo: string | null }[]> {
    const rows = await this.db.execute<{
      match_id: string;
      created_at: unknown;
      ciphertext: Buffer;
      nonce: Buffer;
    }>(sql`
      select match_id, created_at, ciphertext, nonce from messages
       where sender_id = ${userId}::uuid order by created_at`);
    const byMatch = new Map<string, typeof rows.rows>();
    for (const row of rows.rows)
      byMatch.set(row.match_id, [...(byMatch.get(row.match_id) ?? []), row]);
    const texts = new Map<(typeof rows.rows)[number], string | null>();
    for (const [matchId, items] of byMatch) {
      const opened = await this.chatCrypto.openAll(
        matchId,
        items.map((item) => ({ ciphertext: item.ciphertext, nonce: item.nonce })),
      );
      items.forEach((item, index) => texts.set(item, opened[index] ?? null));
    }
    return rows.rows.map((row) => ({
      match_id: row.match_id,
      created_at: row.created_at,
      testo: texts.get(row) ?? null,
    }));
  }

  private async describe(row: ExportRow): Promise<DataExport> {
    const expired =
      row.status === 'ready' && row.expires_at && new Date(row.expires_at) < new Date();
    return {
      id: row.id,
      status: expired ? 'expired' : row.status,
      requestedAt: asDate(row.requested_at)!,
      readyAt: asDate(row.ready_at),
      expiresAt: asDate(row.expires_at),
      downloadUrl:
        row.status === 'ready' && !expired && row.storage_key
          ? await this.storage.signedDownload(row.storage_key, SIGNED_URL_SECONDS.download)
          : null,
    };
  }
}
