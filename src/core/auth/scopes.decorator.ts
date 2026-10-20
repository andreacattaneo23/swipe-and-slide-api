import { SetMetadata } from '@nestjs/common';
import { SessionScope } from './auth-context';

export const SCOPES = 'scopes';
export const PUBLIC_ROUTE = 'publicRoute';

/**
 * Ambiti della sessione ammessi da una rotta (D231). Ogni rotta dell'API dell'app dichiara
 * `@Scopes(...)` oppure `@Public()`: il test di copertura fallisce altrimenti.
 */
export const Scopes = (...scopes: SessionScope[]) => SetMetadata(SCOPES, scopes);

/** Rotta senza sessione (salute, richiesta di codice, nonce, accesso). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
