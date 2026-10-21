import type { Request } from 'express';

export type OperatorRole = 'admin' | 'moderator' | 'support';

/** Operatore della richiesta: stato e ruoli riletti dal database a ogni richiesta (D231). */
export interface OperatorContext {
  operatorId: string;
  sessionId: string;
  roles: OperatorRole[];
}

export interface OperatorRequest extends Request {
  operator?: OperatorContext;
}

/** Intestazione dedicata con il token della sessione dell'operatore (D231). */
export const OPERATOR_HEADER = 'x-operator-token';
