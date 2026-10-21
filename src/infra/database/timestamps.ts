/**
 * Le query SQL scritte a mano restituiscono le date come testo di PostgreSQL: le risposte
 * dell'API le vogliono come date (ISO 8601 in JSON).
 */
export function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}
