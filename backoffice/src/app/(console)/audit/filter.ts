/**
 * Filtri dell'audit letti dall'indirizzo della pagina: tipo, azione e periodo in giorni di Roma.
 * Sono solo codici e date, nessun dato personale (D112).
 */
import { romeToIso } from '@/lib/time';
import type { AuditFilter } from '@/server/admin-api/types';

export type AuditParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function readAuditFilter(params: AuditParams): AuditFilter {
  const type = first(params.type);
  const action = first(params.action)?.trim();
  const from = first(params.from);
  const to = first(params.to);
  const cursor = first(params.cursor);
  const filter: AuditFilter = {};
  if (type === 'action' || type === 'security') filter.type = type;
  if (action && /^[a-z_]{1,60}$/.test(action)) filter.action = action;
  const fromIso = from ? romeToIso(from, '00:00') : null;
  const toIso = to ? romeToIso(to, '23:59') : null;
  if (fromIso) filter.from = fromIso;
  if (toIso) filter.to = toIso.replace(':00.000Z', ':59.999Z');
  if (cursor && /^[\w-]{1,80}$/.test(cursor)) filter.cursor = cursor;
  return filter;
}

/** Stessi filtri come query, per i collegamenti (pagina successiva, esportazione). */
export function auditQuery(params: AuditParams, extra: Record<string, string> = {}): string {
  const search = new URLSearchParams();
  for (const key of ['type', 'action', 'from', 'to']) {
    const value = first(params[key]);
    if (value) search.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}
