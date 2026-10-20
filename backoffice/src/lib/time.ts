/**
 * Tempi della coda delle approvazioni (D141, D144): ore in coda, tempo che resta alle 24 ore e
 * soglia delle 20 ore per l'avviso al team.
 */
import { t, type TextKey } from '@/texts';

export const APPROVAL_WINDOW_HOURS = 24;
export const TEAM_ALERT_HOURS = 20;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "In coda da 21 h" oppure "In coda da 40 min" sotto l'ora. */
export function waitingLabel(submittedAt: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - submittedAt.getTime());
  if (elapsed < HOUR) {
    return t('backoffice.approvalQueue.waiting.minutes', { count: Math.floor(elapsed / MINUTE) });
  }
  return t('backoffice.approvalQueue.waiting.hours', { count: Math.floor(elapsed / HOUR) });
}

/** "Scade tra 3 h": ore intere rimaste, come nei mockup; sotto l'ora i minuti. */
export function dueLabel(dueAt: Date, now: Date): string {
  const left = dueAt.getTime() - now.getTime();
  if (left <= 0) return t('backoffice.approvalQueue.overdue');
  if (left < HOUR) {
    return t('backoffice.approvalQueue.dueIn.minutes', { count: Math.ceil(left / MINUTE) });
  }
  return t('backoffice.approvalQueue.dueIn', { count: Math.floor(left / HOUR) });
}

/** Vero se la revisione è in coda da almeno 20 ore: scadenza vicina e avviso al team (D144). */
export function isNearDue(submittedAt: Date, now: Date): boolean {
  return now.getTime() - submittedAt.getTime() >= TEAM_ALERT_HOURS * HOUR;
}

/** Testo dell'avviso al team: a 20 ore, poi oltre le 24 (D144). */
export function alertKey(submittedAt: Date, now: Date): TextKey | null {
  const elapsed = now.getTime() - submittedAt.getTime();
  if (elapsed >= APPROVAL_WINDOW_HOURS * HOUR) return 'backoffice.approvalQueue.overdue';
  if (elapsed >= TEAM_ALERT_HOURS * HOUR) return 'backoffice.approvalQueue.notice';
  return null;
}

/** Data breve gg/mm/aaaa nel fuso dell'app (Europe/Rome). */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  }).format(date);
}

/** Numero con il separatore delle migliaia italiano ("1.240"). */
export function formatNumber(value: number): string {
  // useGrouping 'always': in italiano anche i numeri di quattro cifre hanno il punto ("1.240").
  return new Intl.NumberFormat('it-IT', { useGrouping: 'always' }).format(value);
}

const ROME = 'Europe/Rome';

/** Scarto in minuti tra l'ora di Roma e UTC in un istante. */
function romeOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ROME,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** Data (aaaa-mm-gg) e ora (hh:mm) di Roma → istante ISO 8601, anche col cambio dell'ora legale. */
export function romeToIso(date: string, time: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) return null;
  const naive = Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, +clock[1]!, +clock[2]!);
  if (Number.isNaN(naive)) return null;
  const first = naive - romeOffsetMinutes(new Date(naive)) * 60_000;
  const second = naive - romeOffsetMinutes(new Date(first)) * 60_000;
  return new Date(second).toISOString();
}

/** "Giovedì 15 ottobre" da una data aaaa-mm-gg. */
export function formatDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return '';
  const day = new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!, 12));
  const text = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(day);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
