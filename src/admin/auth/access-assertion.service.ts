import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { APP_CONFIG, AppConfig } from '../../infra/config/config';

/** Intestazione con il JWT di Cloudflare Access inoltrato dal backoffice (D241). */
export const CF_ACCESS_HEADER = 'cf-access-jwt-assertion';

/**
 * Chiamante di `admin-api` (D241, che sostituisce l'IAM di Cloud Run di D231): il JWT di
 * Cloudflare Access firmato con le chiavi del team (`/cdn-cgi/access/certs`), con l'AUD
 * dell'applicazione. Non sostituisce l'identità dell'operatore: resta obbligatorio
 * `X-Operator-Token`, emesso dopo il codice all'email (D231, D244).
 */
@Injectable()
export class AccessAssertionService implements OnModuleInit {
  private readonly settings: { teamDomain: string; audience: string } | null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.settings = config.adapters.cfAccess;
  }

  onModuleInit(): void {
    if (this.settings && (!this.settings.teamDomain || !this.settings.audience)) {
      throw new Error(
        'Cloudflare Access: CF_ACCESS_TEAM_DOMAIN e CF_ACCESS_AUD mancanti (in sviluppo CF_ACCESS_DISABLED=true)',
      );
    }
  }

  /** Vero se la verifica è spenta (solo sviluppo) o se il JWT è valido. */
  async verify(assertion: string | undefined): Promise<boolean> {
    if (!this.settings) return true;
    if (!assertion) return false;
    this.jwks ??= createRemoteJWKSet(
      new URL(`https://${this.settings.teamDomain}/cdn-cgi/access/certs`),
    );
    try {
      await jwtVerify(assertion, this.jwks, {
        issuer: `https://${this.settings.teamDomain}`,
        audience: this.settings.audience,
        algorithms: ['RS256'],
      });
      return true;
    } catch {
      return false;
    }
  }
}
