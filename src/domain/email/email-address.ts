import { domainToASCII } from 'node:url';

/**
 * Normalizzazione e regole degli indirizzi email (architettura, "Identità verificata e domini
 * dell'elenco"): minuscolo, spazi e punto finale rimossi, dominio internazionale in punycode;
 * il dominio è tutto ciò che segue la `@` e si confronta per corrispondenza esatta.
 */
export interface NormalizedEmail {
  email: string;
  local: string;
  domain: string;
}

const LOCAL_PART = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;

export function normalizeEmail(input: string): NormalizedEmail | null {
  const trimmed = input.trim().toLowerCase().replace(/\.+$/, '');
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1 || trimmed.length > 254) return null;
  const local = trimmed.slice(0, at);
  const domain = domainToASCII(trimmed.slice(at + 1).replace(/\.+$/, ''));
  if (!LOCAL_PART.test(local) || local.length > 64) return null;
  if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return null;
  return { email: `${local}@${domain}`, local, domain };
}

/** Email nascosta di Apple: sempre ammessa come email personale (Proposta 9). */
export const PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';

/**
 * Domini usa e getta più diffusi [Proposta]: elenco nel repository come garanzia (D24); in
 * produzione si aggiorna da una fonte curata.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  'dispostable.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'mailinator.com',
  'maildrop.cc',
  'mintemail.com',
  'sharklasers.com',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
  'yopmail.fr',
]);

/** Provider personali: mai nell'elenco delle aziende (D17, D24). */
export const PERSONAL_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  'aol.com',
  'alice.it',
  'email.it',
  'fastwebnet.it',
  'gmail.com',
  'googlemail.com',
  'gmx.com',
  'hotmail.com',
  'hotmail.it',
  'icloud.com',
  'libero.it',
  'live.com',
  'live.it',
  'me.com',
  'outlook.com',
  'outlook.it',
  'proton.me',
  'protonmail.com',
  'tiscali.it',
  'tim.it',
  'virgilio.it',
  'yahoo.com',
  'yahoo.it',
  PRIVATE_RELAY_DOMAIN,
]);

export function isDisposable(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain);
}

export function isPersonalProvider(domain: string): boolean {
  return PERSONAL_PROVIDER_DOMAINS.has(domain);
}
