import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { otpCodes } from '../../infra/database/schema';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { EMAIL_SENDER, EmailSender } from '../../infra/email/email-sender';
import { otpEmail } from '../../infra/email/email-texts';
import { ApiError } from '../../infra/http/api-error';

export type OtpPurpose = (typeof otpCodes.$inferInsert)['purpose'];

/** Parametri dei codici (D136) e dei reinvii [Proposta: valori da tarare in `config`]. */
export const OTP_RULES = {
  validityMinutes: 10,
  maxAttempts: 5,
  perRecipientPerHour: 5,
  perIpPerHour: 20,
  minSecondsBetweenSends: 30,
} as const;

export type OtpCheck = 'ok' | 'invalid' | 'expired';

/**
 * Codici OTP via email: 6 cifre, 10 minuti, 5 tentativi; un codice per scopo, il nuovo annulla i
 * precedenti dello stesso scopo e destinatario; solo impronte HMAC di codice e destinatario;
 * limiti dei reinvii contati in PostgreSQL (D229).
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    private readonly crypto: CryptoService,
  ) {}

  recipientHash(email: string): string {
    return this.crypto.hash('otp-recipient', email);
  }

  /**
   * Emette e invia un codice. Superato un limite risponde `429` neutro, uguale per indirizzi
   * iscritti e non iscritti. `send: false` serve solo a contare i tentativi senza inviare nulla
   * (indirizzi a cui non si scrive mai, con la stessa risposta).
   */
  async issue(params: {
    email: string;
    purpose: OtpPurpose;
    from: 'neutral' | 'project';
    ip: string | null;
    userId?: string | null;
    send?: boolean;
  }): Promise<void> {
    const recipientHash = this.recipientHash(params.email);
    const ipHash = params.ip ? this.crypto.hash('ip', params.ip) : null;
    const code = this.crypto.otpCode();
    await this.db.transaction(async (tx) => {
      // Un blocco consultivo per destinatario mette in fila le richieste simultanee
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${recipientHash}))`);
      await this.checkLimits(tx, recipientHash, ipHash);
      await tx
        .update(otpCodes)
        .set({ cancelledAt: sql`now()` })
        .where(
          and(
            eq(otpCodes.recipientHash, recipientHash),
            eq(otpCodes.purpose, params.purpose),
            isNull(otpCodes.consumedAt),
            isNull(otpCodes.cancelledAt),
          ),
        );
      await tx.insert(otpCodes).values({
        userId: params.userId ?? null,
        recipientHash,
        purpose: params.purpose,
        codeHash: this.crypto.hash('otp-code', `${recipientHash}:${code}`),
        ipHash,
        expiresAt: sql`now() + make_interval(mins => ${OTP_RULES.validityMinutes})`,
      });
    });
    if (params.send !== false) {
      const { subject, text } = otpEmail(code);
      await this.email.send({ to: params.email, from: params.from, subject, text });
    }
  }

  /**
   * Verifica e consuma il codice in una transazione propria, così un errore conta sempre anche
   * se poi la richiesta fallisce; al quinto errore il codice non vale più.
   */
  async verify(email: string, purpose: OtpPurpose, code: string): Promise<OtpCheck> {
    return this.verifyRecipient(this.recipientHash(email), purpose, code);
  }

  /** Come `verify`, con l'impronta del destinatario già calcolata (sfide degli operatori). */
  async verifyRecipient(
    recipientHash: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<OtpCheck> {
    return this.db.transaction(async (executor): Promise<OtpCheck> => {
      const [row] = await executor
        .select()
        .from(otpCodes)
        .where(
          and(
            eq(otpCodes.recipientHash, recipientHash),
            eq(otpCodes.purpose, purpose),
            isNull(otpCodes.consumedAt),
            isNull(otpCodes.cancelledAt),
          ),
        )
        .orderBy(desc(otpCodes.createdAt))
        .limit(1)
        .for('update');
      if (!row) return 'invalid';
      if (row.expiresAt.getTime() <= Date.now() || row.attempts >= OTP_RULES.maxAttempts) {
        return 'expired';
      }
      const expected = this.crypto.hash('otp-code', `${recipientHash}:${code}`);
      if (!/^\d{6}$/.test(code) || !this.crypto.equalHashes(expected, row.codeHash)) {
        await executor
          .update(otpCodes)
          .set({ attempts: sql`${otpCodes.attempts} + 1` })
          .where(eq(otpCodes.id, row.id));
        return row.attempts + 1 >= OTP_RULES.maxAttempts ? 'expired' : 'invalid';
      }
      await executor
        .update(otpCodes)
        .set({ consumedAt: sql`now()` })
        .where(eq(otpCodes.id, row.id));
      return 'ok';
    });
  }

  /**
   * Verifica del codice con i tentativi rimasti (accesso degli operatori, D88, D244): al quinto
   * errore il codice non vale più (`exhausted`), così la risposta può dirlo senza altri dettagli.
   */
  async verifyWithAttempts(
    recipientHash: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ check: OtpCheck | 'exhausted'; remainingAttempts: number }> {
    return this.db.transaction(async (executor) => {
      const [row] = await executor
        .select()
        .from(otpCodes)
        .where(
          and(
            eq(otpCodes.recipientHash, recipientHash),
            eq(otpCodes.purpose, purpose),
            isNull(otpCodes.consumedAt),
            isNull(otpCodes.cancelledAt),
          ),
        )
        .orderBy(desc(otpCodes.createdAt))
        .limit(1)
        .for('update');
      if (!row) return { check: 'invalid' as const, remainingAttempts: 0 };
      if (row.attempts >= OTP_RULES.maxAttempts) {
        return { check: 'exhausted' as const, remainingAttempts: 0 };
      }
      if (row.expiresAt.getTime() <= Date.now()) {
        return { check: 'expired' as const, remainingAttempts: 0 };
      }
      const expected = this.crypto.hash('otp-code', `${recipientHash}:${code}`);
      if (!/^\d{6}$/.test(code) || !this.crypto.equalHashes(expected, row.codeHash)) {
        await executor
          .update(otpCodes)
          .set({ attempts: sql`${otpCodes.attempts} + 1` })
          .where(eq(otpCodes.id, row.id));
        const remaining = OTP_RULES.maxAttempts - (row.attempts + 1);
        return remaining <= 0
          ? { check: 'exhausted' as const, remainingAttempts: 0 }
          : { check: 'invalid' as const, remainingAttempts: remaining };
      }
      await executor
        .update(otpCodes)
        .set({ consumedAt: sql`now()` })
        .where(eq(otpCodes.id, row.id));
      return { check: 'ok' as const, remainingAttempts: OTP_RULES.maxAttempts - row.attempts };
    });
  }

  /** Verifica che diventa errore dell'API: codice errato o scaduto. */
  async verifyOrThrow(email: string, purpose: OtpPurpose, code: string): Promise<void> {
    const result = await this.verify(email, purpose, code);
    if (result === 'invalid') throw ApiError.badRequest('code.invalid');
    if (result === 'expired') throw ApiError.badRequest('code.expired');
  }

  private async checkLimits(
    tx: Executor,
    recipientHash: string,
    ipHash: string | null,
  ): Promise<void> {
    const hourAgo = sql`now() - interval '1 hour'`;
    const [recent] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${otpCodes.createdAt})`,
      })
      .from(otpCodes)
      .where(and(eq(otpCodes.recipientHash, recipientHash), gt(otpCodes.createdAt, hourAgo)));
    if ((recent?.count ?? 0) >= OTP_RULES.perRecipientPerHour) throw ApiError.tooManyRequests();
    const last = recent?.last ? new Date(recent.last) : null;
    if (last && Date.now() - last.getTime() < OTP_RULES.minSecondsBetweenSends * 1000) {
      throw ApiError.tooManyRequests();
    }
    if (ipHash) {
      const [byIp] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(otpCodes)
        .where(and(eq(otpCodes.ipHash, ipHash), gt(otpCodes.createdAt, hourAgo)));
      if ((byIp?.count ?? 0) >= OTP_RULES.perIpPerHour) throw ApiError.tooManyRequests();
    }
  }
}
