/** Data del calendario italiano (`Europe/Rome`) in formato `AAAA-MM-GG`. */
export function romeDate(now: Date = new Date(), addDays = 0): string {
  const shifted = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/** Aggiunge giorni a una data `AAAA-MM-GG` senza fusi orari. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Converte in `AAAA-MM-GG` una data restituita da `pg`: le query la leggono come testo
 * (`day::text`); un `Date` di `pg` è la mezzanotte locale, quindi si usano le parti locali.
 */
export function asDay(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Array di uuid per i parametri SQL (`::uuid[]`). */
export function uuidArray(ids: string[]): string {
  return `{${ids.join(',')}}`;
}
