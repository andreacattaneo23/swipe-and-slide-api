import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { operators, operatorSessions } from '../../infra/database/schema';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { normalizeEmail } from '../../domain/email/email-address';
import { maskEmail } from '../../domain/email/mask-email';
import { OtpService } from '../../domain/otp/otp.service';
import { OperatorContext, OperatorRole } from './operator-context';
import { OperatorTokenService } from './operator-token.service';

/** Durata breve della sessione dell'operatore, senza rinnovo [Proposta: 8 ore]. */
export const OPERATOR_SESSION_HOURS = 8;
/** Validità del codice all'email dell'operatore, come gli altri codici OTP (10 minuti). */
const CODE_MINUTES = 10;

/**
 * Codici d'errore dell'accesso degli operatori, uguali a quelli del contratto del backoffice
 * (`AdminApiErrorCode`): l'API di amministrazione non usa le chiavi di `testi.js` dell'app.
 * Un codice sbagliato o un indirizzo che non è di un operatore danno sempre
 * `invalid_credentials`, senza dire quale dei due casi.
 */
export const OperatorAuthError = {
  invalidCredentials: 'invalid_credentials',
  codeExpired: 'code_expired',
  tooManyAttempts: 'too_many_attempts',
} as const;

export interface SignInChallenge {
  maskedEmail: string;
  expiresAt: Date;
}

export interface OperatorSessionResult {
  token: string;
  expiresAt: Date;
  operator: { id: string; name: string; roles: OperatorRole[] };
}

/**
 * Accesso degli operatori (D88, D238, D244): `POST /backoffice/auth/code` manda il codice OTP
 * all'email dell'operatore (scopo `operator`, Mailpit in locale) con la stessa risposta per ogni
 * indirizzo; `POST /backoffice/auth/verify` controlla il codice e apre una sessione breve. Nessun
 * TOTP (D244): in produzione il secondo livello è Cloudflare Access (D241). Ogni errore conta
 * come un tentativo sullo stesso codice (al quinto non vale più) e la risposta non dice se
 * l'indirizzo è di un operatore.
 */
@Injectable()
export class OperatorAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly otp: OtpService,
    private readonly tokens: OperatorTokenService,
    private readonly audit: AuditService,
  ) {}

  /** Primo passo: codice all'email (solo se è di un operatore attivo), risposta uguale per tutti. */
  async requestCode(input: string, ip: string): Promise<SignInChallenge> {
    const email = normalizeEmail(input);
    if (!email) throw ApiError.badRequest('validation');
    const operator = await this.activeByEmail(email.email);
    await this.otp.issue({
      email: email.email,
      purpose: 'operator',
      from: 'project',
      ip,
      send: operator !== null,
    });
    return {
      maskedEmail: maskEmail(email.email),
      expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
    };
  }

  /** Secondo passo: codice all'email (D244), poi la sessione. */
  async verify(input: string, code: string): Promise<OperatorSessionResult> {
    const email = normalizeEmail(input);
    if (!email) throw ApiError.badRequest('validation');
    const operator = await this.activeByEmail(email.email);
    const result = await this.otp.verifyWithAttempts(
      this.otp.recipientHash(email.email),
      'operator',
      code,
    );
    if (result.check === 'ok' && operator) return this.openSession(operator);
    await this.audit.write({
      type: 'security',
      action: 'operator_login_failed',
      operatorId: operator?.id ?? null,
      details: { outcome: result.check },
    });
    if (result.check === 'exhausted') {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, OperatorAuthError.tooManyAttempts, {
        remainingAttempts: 0,
      });
    }
    if (result.check === 'expired') throw ApiError.badRequest(OperatorAuthError.codeExpired);
    throw new ApiError(HttpStatus.UNAUTHORIZED, OperatorAuthError.invalidCredentials, {
      remainingAttempts: result.remainingAttempts,
    });
  }

  /** Identità verificata a ogni richiesta: sessione non revocata e ruoli letti dal database. */
  async resolve(token: string): Promise<OperatorContext | null> {
    const claims = await this.tokens.verify(token);
    if (!claims) return null;
    const [row] = await this.db
      .select({
        roles: operators.roles,
        status: operators.status,
      })
      .from(operatorSessions)
      .innerJoin(operators, eq(operators.id, operatorSessions.operatorId))
      .where(
        and(
          eq(operatorSessions.id, claims.sessionId),
          eq(operatorSessions.operatorId, claims.operatorId),
          sql`${operatorSessions.revokedAt} is null`,
          sql`${operatorSessions.expiresAt} > now()`,
        ),
      );
    if (!row || row.status !== 'active') return null;
    return {
      operatorId: claims.operatorId,
      sessionId: claims.sessionId,
      roles: row.roles,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db
      .update(operatorSessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(operatorSessions.id, sessionId));
  }

  private async openSession(
    operator: typeof operators.$inferSelect,
  ): Promise<OperatorSessionResult> {
    const session = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(operatorSessions)
        .values({
          operatorId: operator.id,
          expiresAt: sql`now() + make_interval(hours => ${OPERATOR_SESSION_HOURS})`,
        })
        .returning();
      await this.audit.write(
        {
          type: 'security',
          action: 'operator_login',
          operatorId: operator.id,
          sessionId: created!.id,
        },
        tx,
      );
      return created!;
    });
    const token = await this.tokens.sign(operator.id, session.id, session.expiresAt);
    return {
      token,
      expiresAt: session.expiresAt,
      operator: { id: operator.id, name: operator.name, roles: operator.roles },
    };
  }

  private async activeByEmail(email: string) {
    const [operator] = await this.db
      .select()
      .from(operators)
      .where(and(eq(operators.email, email), eq(operators.status, 'active')));
    return operator ?? null;
  }
}
