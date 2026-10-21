import { Injectable } from '@nestjs/common';
import { type RealtimeEvent } from '../../core/realtime/events';
import { ChannelState } from '../../infra/realtime-bus/channel-state';
import { RealtimeBus } from '../../infra/realtime-bus/realtime-bus';

/**
 * Pubblicazione degli eventi del tempo reale (D180, D182): si chiama **dopo il commit**, con i
 * destinatari già decisi dalla regola core nella transazione della scrittura. Gli eventi portano
 * solo tipo e identificativi. Usato da `app-api`, dai processi e dagli altri domini (approvazione,
 * blocchi, sospensioni) con `closeChannels`.
 */
@Injectable()
export class RealtimePublisher {
  constructor(
    private readonly bus: RealtimeBus,
    private readonly state: ChannelState,
  ) {}

  async publish(userId: string | null | undefined, event: RealtimeEvent): Promise<void> {
    if (!userId) return;
    await this.bus.publish({ userId, event });
  }

  async publishAll(
    items: { userId: string | null | undefined; event: RealtimeEvent }[],
  ): Promise<void> {
    for (const item of items) await this.publish(item.userId, item.event);
  }

  /** Vero se l'utente ha almeno un canale `realtime` connesso (push solo senza canale, D230). */
  isConnected(userId: string): Promise<boolean> {
    return this.state.isConnected(userId);
  }

  /**
   * Chiude i canali di un utente (evento `session`): uscita, revoca di una sessione, "Esci da
   * tutti i dispositivi", sospensione, sanzione o ripensamento (D231). Le sessioni indicate restano
   * segnate come revocate nella cache L2 fino alla scadenza dei loro token; senza sessioni, o con
   * `all`, si chiudono tutti i canali dell'utente.
   */
  async closeChannels(
    userId: string,
    sessionIds: string[] = [],
    options: { all?: boolean } = {},
  ): Promise<void> {
    for (const sessionId of sessionIds) await this.state.revokeSession(sessionId);
    if (options.all || sessionIds.length === 0) {
      await this.publish(userId, { type: 'session' });
      return;
    }
    for (const sessionId of sessionIds) await this.publish(userId, { type: 'session', sessionId });
  }
}
