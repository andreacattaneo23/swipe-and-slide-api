import { jwtVerify } from 'jose';
import { type SessionScope } from './auth-context';

/** Emittente e destinatario dei token di accesso dell'app (gli stessi di `AccessTokenService`). */
export const ACCESS_TOKEN_ISSUER = 'swipe-and-slide';
export const ACCESS_TOKEN_AUDIENCE = 'app';

export interface VerifiedAccessToken {
  userId: string;
  sessionId: string;
  scope: SessionScope;
  /** Scadenza in millisecondi: alla scadenza il canale del tempo reale si chiude. */
  expiresAt: number;
}

/**
 * Verifica di un token di accesso senza database, per il servizio `realtime` (D182, D231): firma,
 * emittente, destinatario e scadenza. Le sessioni revocate si controllano a parte nella cache L2.
 */
export async function verifyAccessToken(
  token: string,
  signingKey: string,
): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(signingKey), {
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    if (typeof payload.exp !== 'number') return null;
    return {
      userId: payload.sub,
      sessionId: payload.sid,
      scope: payload.scope as SessionScope,
      expiresAt: payload.exp * 1000,
    };
  } catch {
    return null;
  }
}
