import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../../infra/http/api-error';
import { AuthenticatedRequest, SessionScope } from '../../core/auth/auth-context';
import { PUBLIC_ROUTE, SCOPES } from '../../core/auth/scopes.decorator';
import { AccessTokenService } from './access-token.service';
import { SessionsService } from './sessions.service';

/**
 * Guard globale dell'API dell'app: ogni rotta è `@Public()` o dichiara `@Scopes(...)`; senza
 * dichiarazione la rotta è chiusa (fail closed). Il token si verifica e la sessione si rilegge
 * dal database a ogni richiesta, così uscita e revoche valgono subito.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;
    const scopes = this.reflector.getAllAndOverride<SessionScope[] | undefined>(SCOPES, targets);
    if (!scopes?.length) throw ApiError.forbidden();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const claims = token ? await this.tokens.verify(token) : null;
    if (!claims) throw ApiError.unauthorized();
    if (!(await this.sessions.isActive(claims.sessionId, claims.userId, claims.scope))) {
      throw ApiError.unauthorized();
    }
    if (!scopes.includes(claims.scope)) throw ApiError.forbidden();
    request.auth = claims;
    return true;
  }
}
