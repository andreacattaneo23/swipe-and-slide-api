/**
 * Cookie del backoffice (architettura, "Accesso degli operatori"; D231):
 * - sessione dell'operatore: token di admin-api cifrato, `HttpOnly`, `SameSite=Strict`, `Secure`
 *   fuori dallo sviluppo locale, durata uguale a quella della sessione (8 ore, senza rinnovo);
 * - procedura di accesso in corso (codice e TOTP): identificativo della sfida, 10 minuti.
 * Con i cookie sicuri si usa il prefisso `__Host-` (niente dominio, percorso `/`).
 */
import 'server-only';
import { cookies } from 'next/headers';
import { readConfig } from './config';
import { seal, unseal } from './seal';

const SESSION_PURPOSE = 'operator-session';
const SIGN_IN_PURPOSE = 'sign-in-flow';
const SIGN_IN_TTL_S = 10 * 60;

export interface StoredSession {
  token: string;
  expiresAt: string;
}

export interface SignInFlow {
  challengeId: string;
  maskedEmail: string;
  step: 'code' | 'totp';
}

function names(secure: boolean) {
  const prefix = secure ? '__Host-' : '';
  return { session: `${prefix}bo_session`, signIn: `${prefix}bo_sign_in` };
}

function baseOptions(secure: boolean) {
  return { httpOnly: true, sameSite: 'strict' as const, secure, path: '/' };
}

export async function saveSession(session: StoredSession): Promise<void> {
  const config = readConfig();
  const maxAge = Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
  const store = await cookies();
  store.set(
    names(config.secureCookies).session,
    seal(session, config.sessionSecret, SESSION_PURPOSE),
    {
      ...baseOptions(config.secureCookies),
      maxAge,
    },
  );
}

export async function readSession(): Promise<StoredSession | null> {
  const config = readConfig();
  const value = (await cookies()).get(names(config.secureCookies).session)?.value;
  if (!value) return null;
  const session = unseal<StoredSession>(value, config.sessionSecret, SESSION_PURPOSE);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
  return session;
}

export async function clearSession(): Promise<void> {
  const config = readConfig();
  (await cookies()).delete({
    name: names(config.secureCookies).session,
    ...baseOptions(config.secureCookies),
  });
}

export async function saveSignInFlow(flow: SignInFlow): Promise<void> {
  const config = readConfig();
  (await cookies()).set(
    names(config.secureCookies).signIn,
    seal(flow, config.sessionSecret, SIGN_IN_PURPOSE),
    { ...baseOptions(config.secureCookies), maxAge: SIGN_IN_TTL_S },
  );
}

export async function readSignInFlow(): Promise<SignInFlow | null> {
  const config = readConfig();
  const value = (await cookies()).get(names(config.secureCookies).signIn)?.value;
  return value ? unseal<SignInFlow>(value, config.sessionSecret, SIGN_IN_PURPOSE) : null;
}

export async function clearSignInFlow(): Promise<void> {
  const config = readConfig();
  (await cookies()).delete({
    name: names(config.secureCookies).signIn,
    ...baseOptions(config.secureCookies),
  });
}

/** Nome del cookie di sessione, per il controllo rapido nel proxy. */
export function sessionCookieNames(): string[] {
  return [names(true).session, names(false).session];
}
