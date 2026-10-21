import { Logger } from '@nestjs/common';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';

/** Una notifica verso un dispositivo: testo a tema e riferimento opaco, mai nomi o foto (D65). */
export interface PushMessage {
  token: string;
  body: string;
  /** Tipo e identificativi per aprire la schermata giusta; nessun dato personale. */
  data: Record<string, string>;
}

/** Invio delle notifiche push; nei test si sostituisce con un doppio definito nel test. */
export abstract class PushSender {
  /** Invia a lotti; restituisce i token da cancellare perché non più validi. */
  abstract send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
}

/**
 * Expo Push vero (`expo-server-sdk`, D65, D240), in sviluppo e in produzione, verso APNs e FCM:
 * lotti dell'SDK; i token non validi (`DeviceNotRegistered` o formato sbagliato) si cancellano.
 * Sul web non ci sono token e non parte nulla. [Proposta] Lettura delle ricevute differite: da fare.
 */
export class ExpoPushSender extends PushSender {
  private readonly logger = new Logger('ExpoPush');
  private readonly expo: Expo;

  constructor(accessToken: string | null) {
    super();
    this.expo = new Expo(accessToken ? { accessToken } : {});
  }

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    const valid: ExpoPushMessage[] = [];
    for (const message of messages) {
      if (!Expo.isExpoPushToken(message.token)) {
        invalidTokens.push(message.token);
        continue;
      }
      valid.push({ to: message.token, body: message.body, data: message.data, sound: 'default' });
    }
    for (const chunk of this.expo.chunkPushNotifications(valid)) {
      try {
        const tickets = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, index) => {
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(String(chunk[index]!.to));
          }
        });
      } catch {
        this.logger.warn('Invio delle notifiche push non riuscito');
      }
    }
    return { invalidTokens };
  }
}
