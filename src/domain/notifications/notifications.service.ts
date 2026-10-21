import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../infra/database/database';
import { PushSender } from '../../infra/push/push-sender';
import { RealtimePublisher } from '../realtime/realtime-publisher';
import { type PushTextKey, pushTexts } from './push-texts';

/** Tipi delle notifiche push (architettura, "Notifiche push"; D65, D114, D197). */
export const NOTIFICATION_TYPES = [
  'new_match',
  'new_message',
  'escalation',
  'invite',
  'match_expiry',
  'reverification',
  'ooo_reminder',
  'offsite',
  'approval',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Tipi che l'utente può spegnere: l'esito dell'approvazione è un avviso di account (D197). */
export const SWITCHABLE_TYPES = NOTIFICATION_TYPES.filter((type) => type !== 'approval');

export interface QuietRange {
  start: string;
  end: string;
}

export interface Notification {
  userId: string;
  type: NotificationType;
  text: PushTextKey;
  /** Riferimento opaco per aprire la schermata giusta: solo identificativi. */
  data?: Record<string, string>;
  /** Solo per i messaggi, usata se l'utente ha attivato le anteprime (D65, D197). */
  preview?: { firstName: string; text: string };
}

export type NotifyResult = 'sent' | 'disabled' | 'quiet' | 'deferred' | 'connected';

/** Ora e minuti nel calendario italiano. */
export function romeMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

const toMinutes = (value: string): number => {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Fasce della "Modalità in riunione", ogni giorno, anche oltre la mezzanotte (D66, D233). */
export function inQuietHours(ranges: QuietRange[], minutes: number): boolean {
  return ranges.some(({ start, end }) => {
    const from = toMinutes(start);
    const to = toMinutes(end);
    if (from === to) return false;
    return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  });
}

/** Notte per i promemoria: tra le 22 e le 8 non partono (architettura, "Promemoria e orari"). */
export const isNight = (minutes: number): boolean => minutes >= 22 * 60 || minutes < 8 * 60;

/**
 * Invio delle notifiche push (`NotificationsModule`): preferenze per tipo, "Modalità in riunione"
 * senza riepilogo (D66, D114), push solo senza un canale `realtime` connesso (D230, D233), testi a
 * tema da `testi.js` senza nomi né foto (D65), token non più validi cancellati. Chi chiama ha già
 * applicato la regola del tipo (match attivo, `can_write`, `can_interact`) nella sua transazione.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly push: PushSender,
    private readonly realtime: RealtimePublisher,
  ) {}

  /**
   * Con `reminder` le notifiche nelle fasce silenziose o di notte si rimandano al passaggio
   * successivo del processo (`deferred`); le altre in fascia silenziosa si perdono (D114).
   */
  async notify(
    notification: Notification,
    options: { reminder?: boolean; now?: Date } = {},
  ): Promise<NotifyResult> {
    const prefs = await this.preferences(notification.userId);
    if (notification.type !== 'approval' && prefs.disabledTypes.includes(notification.type)) {
      return 'disabled';
    }
    const minutes = romeMinutes(options.now ?? new Date());
    if (inQuietHours(prefs.quietHours, minutes)) return options.reminder ? 'deferred' : 'quiet';
    if (options.reminder && isNight(minutes)) return 'deferred';
    if (await this.realtime.isConnected(notification.userId)) return 'connected';
    const devices = await this.db.execute<{ push_token: string }>(
      sql`select push_token from devices where user_id = ${notification.userId}::uuid`,
    );
    if (devices.rows.length === 0) return 'sent';
    const preview =
      prefs.previews && notification.type === 'new_message' ? notification.preview : undefined;
    const body = preview
      ? `${preview.firstName}: ${preview.text.slice(0, 40)}`
      : pushTexts[notification.text];
    const data = {
      type: notification.type,
      ...(notification.data ?? {}),
      ...(preview ? { preview: '1' } : {}),
    };
    const result = await this.push.send(
      devices.rows.map((device) => ({ token: device.push_token, body, data })),
    );
    if (result.invalidTokens.length > 0) {
      await this.db.execute(
        sql`delete from devices where push_token = any(${`{${result.invalidTokens.map((t) => `"${t.replace(/"/g, '')}"`).join(',')}}`}::text[])`,
      );
    }
    return 'sent';
  }

  async preferences(userId: string): Promise<{
    disabledTypes: string[];
    previews: boolean;
    quietHours: QuietRange[];
  }> {
    const result = await this.db.execute<{
      disabled_types: string[];
      previews: boolean;
      quiet_hours: QuietRange[];
    }>(sql`select disabled_types, previews, quiet_hours from notification_preferences
            where user_id = ${userId}::uuid`);
    const row = result.rows[0];
    return {
      disabledTypes: row?.disabled_types ?? [],
      previews: row?.previews ?? false,
      quietHours: row?.quiet_hours ?? [],
    };
  }
}
