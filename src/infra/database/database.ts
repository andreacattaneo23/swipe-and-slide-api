import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

/** Database tipizzato con lo schema del backend; una transazione ha la stessa interfaccia. */
export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Database o transazione in corso: i servizi accettano l'una o l'altra. */
export type Executor = Database | Transaction;

export const DATABASE = Symbol('DATABASE');
export const PG_POOL = Symbol('PG_POOL');

/** SQLSTATE dei trigger del backend (migrazione 0003): sempre risposte neutre verso l'app. */
export const DB_ERRORS = {
  coreRule: 'SSC01',
  realignment: 'SSC02',
  approval: 'SSC03',
  demoAccounts: 'SSC04',
  excludedCompanies: 'SSC05',
  openSpaceLimit: 'SSC06',
  consent: 'SSC07',
  companyCoherence: 'SSC08',
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
} as const;

/** Codice SQLSTATE di un errore, anche quando Drizzle lo avvolge in un suo errore. */
export function pgErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return null;
}
