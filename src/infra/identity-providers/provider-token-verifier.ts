import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { APP_CONFIG, AppConfig } from '../config/config';
import { sha256Hex } from '../crypto/crypto.service';

export type Provider = 'apple' | 'google';

/** Solo `sub` ed email (D224): nome, foto e altri campi del token si scartano. */
export interface VerifiedIdentity {
  provider: Provider;
  subject: string;
  email: string;
  isPrivateRelay: boolean;
}

/** Motivo tecnico di un rifiuto, per l'evento di sicurezza (mai token, `sub` né email). */
export type RejectionReason =
  'signature' | 'issuer' | 'audience' | 'expired' | 'issued_at' | 'nonce' | 'email' | 'malformed';

export class ProviderTokenRejected extends Error {
  constructor(readonly reason: RejectionReason) {
    super(`Token del fornitore rifiutato: ${reason}`);
  }
}

/** Chiavi pubbliche dei fornitori: JWKS remoti in produzione, chiavi di prova nei test. */
export const PROVIDER_KEYS = Symbol('PROVIDER_KEYS');
export type ProviderKeys = Record<Provider, JWTVerifyGetKey>;

export function remoteProviderKeys(config: AppConfig): ProviderKeys {
  // Cache in memoria con nuovo scaricamento per un `kid` sconosciuto, con un limite (jose).
  const options = { cacheMaxAge: 24 * 60 * 60 * 1000, cooldownDuration: 30_000 };
  return {
    apple: createRemoteJWKSet(new URL(config.apple.jwksUrl), options),
    google: createRemoteJWKSet(new URL(config.google.jwksUrl), options),
  };
}

const PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';
const CLOCK_TOLERANCE_SECONDS = 60;
const MAX_TOKEN_AGE_SECONDS = 10 * 60;

/**
 * Verifica dei token d'identità di Apple e Google (`ProviderTokenVerifier`, architettura
 * "Accesso con Apple e Google"): firma con i JWKS, `iss`, `aud`, `exp` e `iat` con 60 secondi
 * di tolleranza, `nonce` (impronta SHA-256 per Apple, valore per Google) ed `email_verified`.
 */
@Injectable()
export class ProviderTokenVerifier {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROVIDER_KEYS) private readonly keys: ProviderKeys,
  ) {}

  async verify(provider: Provider, idToken: string, nonce: string): Promise<VerifiedIdentity> {
    const settings =
      provider === 'apple'
        ? { issuer: this.config.apple.issuer, audience: this.config.apple.audiences }
        : { issuer: this.config.google.issuers, audience: this.config.google.audiences };
    if (settings.audience.length === 0) throw new ProviderTokenRejected('audience');
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys[provider], {
        issuer: settings.issuer,
        audience: settings.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        maxTokenAge: MAX_TOKEN_AGE_SECONDS,
        requiredClaims: ['sub', 'iat', 'exp'],
      }));
    } catch (error) {
      throw new ProviderTokenRejected(rejectionReason(error));
    }
    const expectedNonce = provider === 'apple' ? sha256Hex(nonce) : nonce;
    if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
      throw new ProviderTokenRejected('nonce');
    }
    if (
      provider === 'google' &&
      typeof payload.azp === 'string' &&
      !settings.audience.includes(payload.azp)
    ) {
      throw new ProviderTokenRejected('audience');
    }
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const verified = payload.email_verified === true || payload.email_verified === 'true';
    if (!email || !verified || typeof payload.sub !== 'string') {
      throw new ProviderTokenRejected('email');
    }
    const isPrivateRelay =
      provider === 'apple' &&
      (payload.is_private_email === true ||
        payload.is_private_email === 'true' ||
        email.endsWith(`@${PRIVATE_RELAY_DOMAIN}`));
    return { provider, subject: payload.sub, email, isPrivateRelay };
  }
}

function rejectionReason(error: unknown): RejectionReason {
  if (error instanceof errors.JWTExpired) return 'expired';
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === 'iss') return 'issuer';
    if (error.claim === 'aud') return 'audience';
    if (error.claim === 'iat') return 'issued_at';
    return 'malformed';
  }
  if (
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JOSEAlgNotAllowed
  ) {
    return 'signature';
  }
  return 'malformed';
}
