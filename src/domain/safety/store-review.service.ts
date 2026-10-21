import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { storeReviewWindows } from '../../infra/database/schema-safety';
import { AuditService } from '../../infra/audit/audit.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError } from '../../infra/http/api-error';
import { OperatorAction } from '../companies/companies.service';
import { SafetySettings } from './safety-settings.service';

export interface ReviewWindow {
  id: string;
  store: 'apple' | 'google';
  openedAt: Date;
  /** Fine prevista della finestra (al massimo 14 giorni). */
  endsAt: Date;
  failedAttempts: number;
  closedAt: Date | null;
}

export interface DemoAccount {
  id: string;
  firstName: string;
  companyName: string;
  maskedEmail: string;
}

/**
 * Finestre di revisione degli store e codice di revisione (D42, D118): codice nuovo a ogni
 * finestra nel formato del codice OTP, mostrato una sola volta e salvato come impronta, al massimo
 * 10 tentativi e 14 giorni. Il codice vale solo per gli account dimostrativi (RC-87, RC-209); alla
 * chiusura le sessioni dimostrative si revocano e i dati dimostrativi si azzerano.
 */
@Injectable()
export class StoreReviewService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly settings: SafetySettings,
  ) {}

  /** Ultime finestre e account dimostrativi (nome, azienda, email mascherata). */
  async overview(): Promise<{ windows: ReviewWindow[]; accounts: DemoAccount[] }> {
    const rows = await this.db
      .select()
      .from(storeReviewWindows)
      .orderBy(desc(storeReviewWindows.openedAt))
      .limit(20);
    const accounts = await this.db.execute<{
      id: string;
      first_name: string | null;
      company_name: string;
      masked_email: string | null;
    }>(sql`select * from backoffice_demo_accounts order by company_name, first_name`);
    return {
      windows: rows.map(toWindow),
      accounts: accounts.rows.map((row) => ({
        id: row.id,
        firstName: row.first_name ?? '',
        companyName: row.company_name,
        maskedEmail: row.masked_email ?? '',
      })),
    };
  }

  /** Nuova finestra: chiude quella aperta e restituisce il codice una sola volta. */
  async open(
    store: 'apple' | 'google',
    days: number,
    by: OperatorAction,
  ): Promise<{ window: ReviewWindow; code: string }> {
    const max = await this.settings.int('review_window.max_days', 14);
    if (!Number.isInteger(days) || days < 1 || days > max) {
      throw ApiError.badRequest('validation', { field: 'days' });
    }
    const code = this.crypto.otpCode();
    const row = await this.db.transaction(async (tx) => {
      await tx
        .update(storeReviewWindows)
        .set({ closedAt: sql`now()` })
        .where(isNull(storeReviewWindows.closedAt));
      const [created] = await tx
        .insert(storeReviewWindows)
        .values({
          openedBy: by.operatorId,
          store,
          closesAt: sql`now() + make_interval(days => ${days})`,
          codeHash: this.codeHash(code),
        })
        .returning();
      await this.audit.write(
        {
          type: 'action',
          action: 'review_window_opened',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'store_review_window',
          objectId: created!.id,
          explanation: by.explanation,
          details: { days, store },
        },
        tx,
      );
      return created!;
    });
    return { window: toWindow(row), code };
  }

  /** Chiusura manuale: il codice non vale più, sessioni dimostrative revocate, dati azzerati. */
  async close(by: OperatorAction | null, id?: string): Promise<ReviewWindow | null> {
    return this.db.transaction(async (tx) => {
      const closed = await tx
        .update(storeReviewWindows)
        .set({ closedAt: sql`now()` })
        .where(
          id
            ? and(eq(storeReviewWindows.id, id), isNull(storeReviewWindows.closedAt))
            : isNull(storeReviewWindows.closedAt),
        )
        .returning();
      if (!closed.length) return null;
      await tx.execute(sql`select reset_demo_data()`);
      await this.audit.write(
        {
          type: 'action',
          action: 'review_window_closed',
          operatorId: by?.operatorId ?? null,
          sessionId: by?.sessionId ?? null,
          objectType: 'store_review_window',
          objectId: closed[0]!.id,
          explanation: by?.explanation ?? null,
        },
        tx,
      );
      return toWindow(closed[0]!);
    });
  }

  /** Azzeramento dei dati dimostrativi dopo una revisione (D42, RC-89). */
  async reset(by: OperatorAction): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ touched: number }>(
        sql`select reset_demo_data() as touched`,
      );
      const touched = Number(result.rows[0]?.touched ?? 0);
      await this.audit.write(
        {
          type: 'action',
          action: 'demo_data_reset',
          operatorId: by.operatorId,
          sessionId: by.sessionId,
          objectType: 'demo',
          explanation: by.explanation,
          details: { rows: touched },
        },
        tx,
      );
      return touched;
    });
  }

  /**
   * Codice di revisione all'accesso di un account dimostrativo (RC-87): valido solo con una
   * finestra aperta; ogni tentativo resta nell'audit, senza il codice; dopo 10 errori la finestra
   * si chiude.
   */
  async verifyCode(code: string, userId: string): Promise<boolean> {
    const maxAttempts = await this.settings.int('review_window.max_attempts', 10);
    return this.db.transaction(async (tx) => {
      const [window] = await tx
        .select()
        .from(storeReviewWindows)
        .where(
          and(isNull(storeReviewWindows.closedAt), sql`${storeReviewWindows.closesAt} > now()`),
        )
        .for('update');
      if (!window) return false;
      const ok =
        /^\d{6}$/.test(code) && this.crypto.equalHashes(this.codeHash(code), window.codeHash);
      if (!ok) {
        const attempts = window.failedAttempts + 1;
        await tx
          .update(storeReviewWindows)
          .set({
            failedAttempts: Math.min(attempts, maxAttempts),
            ...(attempts >= maxAttempts ? { closedAt: sql`now()` } : {}),
          })
          .where(eq(storeReviewWindows.id, window.id));
      }
      await this.audit.write(
        {
          type: 'security',
          action: 'review_code_wrong',
          objectType: 'user',
          objectId: userId,
          details: { ok },
        },
        tx,
      );
      return ok;
    });
  }

  private codeHash(code: string): string {
    return this.crypto.hash('review-code', code);
  }
}

function toWindow(row: typeof storeReviewWindows.$inferSelect): ReviewWindow {
  return {
    id: row.id,
    store: row.store,
    openedAt: row.openedAt,
    endsAt: row.closesAt,
    failedAttempts: row.failedAttempts,
    closedAt: row.closedAt,
  };
}
