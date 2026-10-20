import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, AppConfig } from '../../infra/config/config';
import { SessionScope } from '../../core/auth/auth-context';

/** Durate dei token dell'app (D231). */
export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_DAYS = 30;

const ISSUER = 'swipe-and-slide';
const AUDIENCE = 'app';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  scope: SessionScope;
}

/**
 * Token di accesso dell'app: JWT HS256 di 15 minuti con destinatario `app`, che non vale su
 * `admin-api` (chiave e destinatario diversi). [Proposta] In produzione la chiave viene da
 * Secret Manager; la rotazione con più chiavi attive resta da fare.
 */
@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = new TextEncoder().encode(config.jwtAccessSigningKey);
  }

  async sign(claims: AccessClaims): Promise<string> {
    return new SignJWT({ sid: claims.sessionId, scope: claims.scope })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { userId: payload.sub, sessionId: payload.sid, scope: payload.scope as SessionScope };
    } catch {
      return null;
    }
  }
}
