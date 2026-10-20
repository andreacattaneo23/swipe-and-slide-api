import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, AppConfig } from '../../infra/config/config';

const ISSUER = 'swipe-and-slide';
const AUDIENCE = 'admin-api';

/**
 * Token della sessione dell'operatore emesso da `admin-api` dopo OTP e TOTP: JWT con
 * destinatario `admin-api`, `operator_id`, sessione e ora dell'ultimo TOTP (D231). Chiave e
 * destinatario diversi da quelli dell'app: i due token non valgono sull'altra API.
 */
@Injectable()
export class OperatorTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = new TextEncoder().encode(config.jwtAdminSigningKey);
  }

  sign(operatorId: string, sessionId: string, lastTotpAt: Date, expiresAt: Date): Promise<string> {
    return new SignJWT({ sid: sessionId, totp_at: Math.floor(lastTotpAt.getTime() / 1000) })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(operatorId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
  }

  async verify(token: string): Promise<{ operatorId: string; sessionId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { operatorId: payload.sub, sessionId: payload.sid };
    } catch {
      return null;
    }
  }
}
