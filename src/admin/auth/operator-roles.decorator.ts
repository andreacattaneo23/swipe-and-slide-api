import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiError } from '../../infra/http/api-error';
import { OperatorContext, OperatorRequest, OperatorRole } from './operator-context';

export const OPERATOR_ROLES = 'operatorRoles';

/** Ruoli dell'operatore ammessi da una rotta (D88, D231); senza dichiarazione la rotta è chiusa. */
export const OperatorRoles = (...roles: OperatorRole[]) => SetMetadata(OPERATOR_ROLES, roles);

/** Operatore della sessione (`@CurrentOperator()`). */
export const CurrentOperator = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<OperatorRequest>();
  if (!request.operator) throw ApiError.unauthorized();
  return request.operator satisfies OperatorContext;
});
