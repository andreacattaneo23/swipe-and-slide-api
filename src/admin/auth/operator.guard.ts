import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '../../infra/http/api-error';
import { PUBLIC_ROUTE } from '../../core/auth/scopes.decorator';
import { OperatorAuthService } from './operator-auth.service';
import { OPERATOR_HEADER, OperatorRequest, OperatorRole } from './operator-context';
import { OPERATOR_ROLES } from './operator-roles.decorator';

/**
 * Guard globale di `admin-api` (D231): oltre all'account di servizio del backoffice (Cloud Run
 * IAM in produzione), ogni richiesta porta il token della sessione dell'operatore; sessione,
 * stato e ruoli si leggono dal database a ogni richiesta. Ogni rotta dichiara
 * `@OperatorRoles(...)` o `@Public()`, altrimenti è chiusa.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: OperatorAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;
    const roles = this.reflector.getAllAndOverride<OperatorRole[] | undefined>(
      OPERATOR_ROLES,
      targets,
    );
    if (!roles?.length) throw ApiError.forbidden();
    const request = context.switchToHttp().getRequest<OperatorRequest>();
    const header = request.headers[OPERATOR_HEADER];
    const token = typeof header === 'string' ? header : '';
    const operator = token ? await this.auth.resolve(token) : null;
    if (!operator) throw ApiError.unauthorized();
    if (!operator.roles.some((role) => roles.includes(role))) throw ApiError.forbidden();
    request.operator = operator;
    return true;
  }
}
