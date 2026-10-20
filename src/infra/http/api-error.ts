import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Codici d'errore dell'API. Dove l'app mostra un testo dedicato, il codice è la chiave di
 * `testi.js` (es. `registration.blocked`); gli altri sono codici tecnici che l'app traduce con i
 * testi generici (`error.generic`, `error.network`). Il backend non scrive testi dell'app.
 */
export const ErrorCode = {
  notFound: 'not_found',
  validation: 'validation',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  conflict: 'conflict',
  rateLimited: 'rate_limited',
  internal: 'internal',
  stepOrder: 'registration.stepOrder',
  codeInvalid: 'code.invalid',
  codeExpired: 'code.expired',
  providerToken: 'signIn.error.token',
  workEmailAsPersonal: 'signIn.error.workEmail',
  workAccount: 'signIn.error.workAccount',
  disposable: 'signIn.error.disposable',
  emailInUse: 'signIn.error.emailInUse',
  registrationBlocked: 'registration.blocked',
  workEmailInUse: 'registration.email.inUse',
  workEmailPersonal: 'registration.email.personal',
  domainNotListed: 'registration.domain.notListed',
  underage: 'registration.underage',
  consentMissing: 'registration.consent.error',
  declarationMissing: 'registration.declaration.error',
  termsMissing: 'registration.terms.error',
  registrationExpired: 'registration.expired',
  noAccount: 'signIn.noAccount',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super({ code, ...extra }, status);
  }

  /** `404` uguale per ogni motivo di non visibilità (architettura, "Comportamento uniforme"). */
  static notFound(): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, ErrorCode.notFound);
  }

  static badRequest(code: string, extra?: Record<string, unknown>): ApiError {
    return new ApiError(HttpStatus.BAD_REQUEST, code, extra);
  }

  static conflict(code: string, extra?: Record<string, unknown>): ApiError {
    return new ApiError(HttpStatus.CONFLICT, code, extra);
  }

  static unauthorized(): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, ErrorCode.unauthorized);
  }

  static forbidden(): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, ErrorCode.forbidden);
  }

  static tooManyRequests(extra?: Record<string, unknown>): ApiError {
    return new ApiError(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.rateLimited, extra);
  }
}
