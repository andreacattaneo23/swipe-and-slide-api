import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { DB_ERRORS, pgErrorCode } from '../database/database';
import { ErrorCode } from './api-error';

/**
 * Formato unico degli errori `{ error: { code, ... } }`, senza stack né dettagli del database
 * (README, "Superficie HTTP"). Gli errori della regola core dei trigger diventano il `404`
 * neutro; il limite dell'Open space un `429` neutro.
 */
/** Codice d'errore per gli stati HTTP senza un codice proprio. */
const STATUS_CODES: Record<number, string> = {
  [HttpStatus.NOT_FOUND]: ErrorCode.notFound,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.unauthorized,
  [HttpStatus.FORBIDDEN]: ErrorCode.forbidden,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.rateLimited,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.validation,
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    response.status(status).setHeader('Cache-Control', 'no-store').json({ error: body });
  }

  private toResponse(exception: unknown): { status: number; body: Record<string, unknown> } {
    if (exception instanceof HttpException) {
      const status: number = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        return { status, body: payload };
      }
      if (status === 400) {
        const fields = (payload as { message?: unknown }).message;
        return {
          status,
          body: { code: ErrorCode.validation, fields: Array.isArray(fields) ? fields : [] },
        };
      }
      const code = STATUS_CODES[status] ?? ErrorCode.internal;
      return { status, body: { code } };
    }
    const sqlState = pgErrorCode(exception);
    if (sqlState === DB_ERRORS.coreRule) {
      // Non deve succedere: lo strato 2 è stato saltato o c'è stata una corsa (architettura)
      this.logger.warn('Trigger della regola core scattato');
      return { status: HttpStatus.NOT_FOUND, body: { code: ErrorCode.notFound } };
    }
    if (sqlState === DB_ERRORS.openSpaceLimit) {
      return { status: HttpStatus.TOO_MANY_REQUESTS, body: { code: ErrorCode.rateLimited } };
    }
    if (sqlState?.startsWith('SS') || sqlState === DB_ERRORS.uniqueViolation) {
      return { status: HttpStatus.CONFLICT, body: { code: ErrorCode.conflict } };
    }
    const cause = (exception as { cause?: { message?: string } })?.cause?.message;
    this.logger.error(
      exception instanceof Error
        ? exception.message.split('\n')[0] + (cause ? ` (${cause})` : '')
        : 'Errore sconosciuto',
    );
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: { code: ErrorCode.internal } };
  }
}
