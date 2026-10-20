import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { operators, operatorSessions } from '../../infra/database/schema';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError } from '../../infra/http/api-error';
import { normalizeEmail } from '../../domain/email/email-address';
import { OtpService } from '../../domain/otp/otp.service';
import { OperatorContext } from './operator-context';
import { OperatorTokenService } from './operator-token.service';
import { TotpService } from './totp.service';

/** Durata breve della sessione dell'operatore, senza rinnovo [Proposta: 8 ore]. */
export const OPERATOR_SESSION_HOURS = 8;

/**
 * Accesso degli operatori: codice OTP all'email dell'operatore (scopo `operator`, in sviluppo
 * nel log) e codice TOTP; poi una sessione breve. Stessa risposta per indirizzi sconosciuti.
 */
@Injectable()
export class OperatorAuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly otp: OtpService,
    private readonly totp: TotpService,
    private readonly tokens: OperatorTokenService,
    private readonly audit: AuditService,
  ) {}

  async requestCode(input: string, ip: string): Promise<void> {
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
  }

  async verify(
    input: string,
    code: string,
    totpCode: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const email = normalizeEmail(input);
    if (!email) throw ApiError.badRequest('validation');
    const check = await this.otp.verify(email.email, 'operator', code);
    const operator = check === 'ok' ? await this.activeByEmail(email.email) : null;
    if (!operator || !(await this.totp.check(operator.encryptedTotpSecret, totpCode))) {
      await this.audit.write({
        type: 'security',
        action: 'operator_login_failed',
        operatorId: operator?.id ?? null,
        details: { step: check === 'ok' ? 'totp' : 'code' },
      });
      throw ApiError.unauthorized();
    }
    const [session] = await this.db
      .insert(operatorSessions)
      .values({
        operatorId: operator.id,
        lastTotpAt: sql`now()`,
        expiresAt: sql`now() + make_interval(hours => ${OPERATOR_SESSION_HOURS})`,
      })
      .returning();
    await this.audit.write({
      type: 'security',
      action: 'operator_login',
      operatorId: operator.id,
      sessionId: session!.id,
    });
    const token = await this.tokens.sign(
      operator.id,
      session!.id,
      session!.lastTotpAt,
      session!.expiresAt,
    );
    return { token, expiresAt: session!.expiresAt };
  }

  /** Identità verificata a ogni richiesta: sessione non revocata e ruoli letti dal database. */
  async resolve(token: string): Promise<OperatorContext | null> {
    const claims = await this.tokens.verify(token);
    if (!claims) return null;
    const [row] = await this.db
      .select({
        roles: operators.roles,
        status: operators.status,
        lastTotpAt: operatorSessions.lastTotpAt,
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
      lastTotpAt: row.lastTotpAt,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db
      .update(operatorSessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(operatorSessions.id, sessionId));
  }

  /** Conferma rafforzata (D93): un codice TOTP appena generato, verificato di nuovo. */
  async confirmTotp(operatorId: string, code: string | undefined): Promise<void> {
    const [operator] = await this.db
      .select({ secret: operators.encryptedTotpSecret })
      .from(operators)
      .where(eq(operators.id, operatorId));
    if (!operator || !code || !(await this.totp.check(operator.secret, code))) {
      throw ApiError.forbidden();
    }
  }

  private async activeByEmail(email: string) {
    const [operator] = await this.db
      .select()
      .from(operators)
      .where(and(eq(operators.email, email), eq(operators.status, 'active')));
    return operator ?? null;
  }
}
