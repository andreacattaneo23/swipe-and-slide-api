import { Injectable } from '@nestjs/common';
import { AuditService } from '../../infra/audit/audit.service';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import {
  Provider,
  ProviderTokenRejected,
  ProviderTokenVerifier,
  VerifiedIdentity,
} from '../../infra/identity-providers/provider-token-verifier';
import { NonceService } from './nonce.service';

/** Verifica comune a accesso e registrazione: nonce del server consumato, poi il token. */
@Injectable()
export class ProviderSignInService {
  constructor(
    private readonly nonces: NonceService,
    private readonly verifier: ProviderTokenVerifier,
    private readonly audit: AuditService,
  ) {}

  async verify(
    provider: Provider,
    identityToken?: string,
    nonce?: string,
  ): Promise<VerifiedIdentity> {
    if (!identityToken || !nonce) throw ApiError.badRequest(ErrorCode.validation);
    if (!(await this.nonces.consume(nonce))) {
      await this.reject(provider, 'nonce');
    }
    try {
      return await this.verifier.verify(provider, identityToken, nonce);
    } catch (error) {
      if (error instanceof ProviderTokenRejected) await this.reject(provider, error.reason);
      throw error;
    }
  }

  /** Evento di sicurezza con il solo motivo tecnico, mai token, `sub` né email (RC-208). */
  private async reject(provider: Provider, reason: string): Promise<never> {
    await this.audit.write({
      type: 'security',
      action: 'provider_token_rejected',
      objectType: 'provider',
      objectId: provider,
      details: { reason },
    });
    throw new ApiError(401, ErrorCode.providerToken);
  }
}
