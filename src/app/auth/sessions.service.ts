import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { profileReviews, sessions, users } from '../../infra/database/schema';
import { AuditService } from '../../infra/audit/audit.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError } from '../../infra/http/api-error';
import { SessionScope } from '../../core/auth/auth-context';
import {
  ACCESS_TOKEN_SECONDS,
  AccessTokenService,
  REFRESH_TOKEN_DAYS,
} from './access-token.service';

export type SignInMethod = (typeof sessions.$inferInsert)['signInMethod'];

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: SessionScope;
}

/**
 * Sessioni dell'app (D231): token di rinnovo opaco di 30 giorni, salvato come impronta e
 * sostituito a ogni uso; il riuso di un token già sostituito revoca l'intera sessione. Il token
 * di rinnovo è `<sessione>.<segreto>`, così un riuso si riconosce anche dopo la rotazione.
 * L'ambito si ricalcola dallo stato dell'account a ogni rinnovo.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly tokens: AccessTokenService,
    private readonly audit: AuditService,
  ) {}

  /** Ambito della sessione dallo stato dell'account (architettura, "Registrazione e accesso"). */
  async scopeFor(userId: string, tx: Executor = this.db): Promise<SessionScope | null> {
    const [user] = await tx
      .select({ status: users.status, deletionRequestedAt: users.deletionRequestedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.status === 'deleted') return null;
    if (user.deletionRequestedAt) return 'limited';
    if (user.status === 'registering') return 'registration';
    if (user.status === 'suspended') return 'restore';
    if (user.status === 'pending_approval') {
      const [last] = await tx
        .select({ attempt: profileReviews.attempt, outcome: profileReviews.outcome })
        .from(profileReviews)
        .where(eq(profileReviews.userId, userId))
        .orderBy(desc(profileReviews.attempt))
        .limit(1);
      return last?.outcome === 'rejected' && last.attempt >= 3 ? 'limited' : 'approval';
    }
    const sanctioned = await tx.execute<{ visible: boolean }>(
      sql`select account_visible(${userId}::uuid) as visible`,
    );
    return sanctioned.rows[0]?.visible === true ? 'full' : 'limited';
  }

  async create(
    userId: string,
    method: SignInMethod,
    tx: Executor = this.db,
  ): Promise<SessionTokens> {
    const scope = await this.scopeFor(userId, tx);
    if (!scope) throw ApiError.unauthorized();
    const secret = this.crypto.randomToken();
    const [session] = await tx
      .insert(sessions)
      .values({
        userId,
        refreshHash: 'pending',
        scope,
        signInMethod: method,
        expiresAt: sql`now() + make_interval(days => ${REFRESH_TOKEN_DAYS})`,
      })
      .returning({ id: sessions.id });
    const refreshToken = `${session!.id}.${secret}`;
    await tx
      .update(sessions)
      .set({ refreshHash: this.crypto.hash('refresh', refreshToken) })
      .where(eq(sessions.id, session!.id));
    return this.tokensFor(userId, session!.id, scope, refreshToken);
  }

  /** Rinnovo con rotazione; il riuso di un token sostituito revoca la sessione. */
  async refresh(refreshToken: string): Promise<SessionTokens> {
    const sessionId = refreshToken.split('.')[0] ?? '';
    if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw ApiError.unauthorized();
    return this.db
      .transaction(async (tx) => {
        const [session] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, sessionId))
          .for('update');
        if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
          throw ApiError.unauthorized();
        }
        const presented = this.crypto.hash('refresh', refreshToken);
        if (!this.crypto.equalHashes(presented, session.refreshHash)) {
          await tx
            .update(sessions)
            .set({ revokedAt: sql`now()` })
            .where(eq(sessions.id, sessionId));
          await this.audit.write(
            {
              type: 'security',
              action: 'refresh_token_reused',
              objectType: 'session',
              objectId: sessionId,
            },
            tx,
          );
          return null;
        }
        const scope = await this.scopeFor(session.userId, tx);
        if (!scope) throw ApiError.unauthorized();
        const next = `${sessionId}.${this.crypto.randomToken()}`;
        await tx
          .update(sessions)
          .set({
            refreshHash: this.crypto.hash('refresh', next),
            scope,
            lastRefreshedAt: sql`now()`,
          })
          .where(eq(sessions.id, sessionId));
        return this.tokensFor(session.userId, sessionId, scope, next);
      })
      .then((result) => {
        // La revoca per riuso si conferma prima di rispondere `401`
        if (!result) throw ApiError.unauthorized();
        return result;
      });
  }

  /** Nuovo token di accesso con l'ambito aggiornato (es. dopo il completamento). */
  async reissue(
    userId: string,
    sessionId: string,
    tx: Executor = this.db,
  ): Promise<{ accessToken: string; expiresIn: number; scope: SessionScope }> {
    const scope = await this.scopeFor(userId, tx);
    if (!scope) throw ApiError.unauthorized();
    await tx.update(sessions).set({ scope }).where(eq(sessions.id, sessionId));
    const accessToken = await this.tokens.sign({ userId, sessionId, scope });
    return { accessToken, expiresIn: ACCESS_TOKEN_SECONDS, scope };
  }

  /** Sessione valida per la richiesta: non revocata, non scaduta, con lo stesso ambito. */
  async isActive(sessionId: string, userId: string, scope: SessionScope): Promise<boolean> {
    const [session] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, userId),
          eq(sessions.scope, scope),
          isNull(sessions.revokedAt),
          sql`${sessions.expiresAt} > now()`,
        ),
      );
    return session !== undefined;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(sessions.id, sessionId));
  }

  /** "Esci da tutti i dispositivi". [Proposta] Chiusura dei canali `realtime`: da fare. */
  async revokeAll(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  private async tokensFor(
    userId: string,
    sessionId: string,
    scope: SessionScope,
    refreshToken: string,
  ): Promise<SessionTokens> {
    const accessToken = await this.tokens.sign({ userId, sessionId, scope });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_SECONDS, scope };
  }
}
