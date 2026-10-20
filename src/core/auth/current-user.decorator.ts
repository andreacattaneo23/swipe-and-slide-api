import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiError } from '../../infra/http/api-error';
import { AuthContext, AuthenticatedRequest } from './auth-context';

/** Utente della sessione (`@CurrentUser()`), sempre presente nelle rotte con `@Scopes`. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.auth) throw ApiError.unauthorized();
  return request.auth satisfies AuthContext;
});
