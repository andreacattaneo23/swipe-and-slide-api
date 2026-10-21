/**
 * Eventi del tempo reale (architettura, "Tempo reale"; glossario "Eventi del tempo reale"):
 * solo il tipo e gli identificativi, mai testi, nomi, foto o motivi (D182). L'app rilegge i dati
 * con le rotte dell'API, che applicano di nuovo la regola al momento della lettura. I destinatari
 * li decide il backend con la regola core, nella transazione della scrittura.
 */
export type RealtimeEvent =
  | { type: 'message'; matchId: string; messageId: string }
  | { type: 'read'; matchId: string; messageId: string }
  | { type: 'match'; matchId: string; status: 'active' | 'unavailable' }
  | { type: 'invite'; matchId: string; inviteId: string }
  | { type: 'agenda' }
  | { type: 'approval'; outcome: 'approved' | 'rejected' }
  | { type: 'offsite'; offsiteId: string; attendeesRounded: number | null }
  | { type: 'tabs' }
  | { type: 'session'; sessionId?: string };

export type RealtimeEventType = RealtimeEvent['type'];

/** Busta che viaggia su Redis: destinatario e evento (mai altro). */
export interface RealtimeEnvelope {
  userId: string;
  event: RealtimeEvent;
}

/** Canale Redis degli eventi verso le istanze di `realtime`. */
export const REALTIME_CHANNEL = 'rt:events';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDS = ['matchId', 'messageId', 'inviteId', 'offsiteId', 'sessionId'] as const;
const TYPES = new Set<RealtimeEventType>([
  'message',
  'read',
  'match',
  'invite',
  'agenda',
  'approval',
  'offsite',
  'tabs',
  'session',
]);

/**
 * Ricostruisce una busta da un testo ricevuto, tenendo solo i campi ammessi: un evento con altri
 * campi (es. un testo) non passa nemmeno se un servizio lo pubblicasse per errore.
 */
export function parseEnvelope(raw: string): RealtimeEnvelope | null {
  try {
    const value = JSON.parse(raw) as { userId?: unknown; event?: Record<string, unknown> };
    if (typeof value.userId !== 'string' || !UUID.test(value.userId) || !value.event) return null;
    const type = value.event.type as RealtimeEventType;
    if (!TYPES.has(type)) return null;
    const event: Record<string, unknown> = { type };
    for (const key of IDS) {
      const id = value.event[key];
      if (typeof id === 'string' && UUID.test(id)) event[key] = id;
    }
    if (type === 'match' && ['active', 'unavailable'].includes(String(value.event.status))) {
      event.status = value.event.status;
    }
    if (type === 'approval' && ['approved', 'rejected'].includes(String(value.event.outcome))) {
      event.outcome = value.event.outcome;
    }
    if (type === 'offsite') {
      const n = value.event.attendeesRounded;
      event.attendeesRounded = typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
    }
    return { userId: value.userId, event: event as RealtimeEvent };
  } catch {
    return null;
  }
}
