import { Injectable, Logger } from '@nestjs/common';
import { type AccountNotifier } from '../account/account-notifier';
import { RealtimePublisher } from '../realtime/realtime-publisher';
import { UserEvents, type UserEventType } from '../safety/user-events';
import { NotificationsService } from './notifications.service';

/**
 * Notifiche del profilo e dell'account (`ACCOUNT_NOTIFIER`): promemoria della ri-verifica e
 * promemoria OOO passano dal servizio delle notifiche, con preferenze, "Modalità in riunione" e
 * push solo senza un canale connesso (D65, D114, D230). Testi discreti da `testi.js`.
 */
@Injectable()
export class PushAccountNotifier implements AccountNotifier {
  constructor(private readonly notifications: NotificationsService) {}

  async notify(userId: string, type: 'reverification' | 'ooo_reminder'): Promise<void> {
    await this.notifications.notify({
      userId,
      type,
      text: type === 'reverification' ? 'reverification.title' : 'notification.ooo',
    });
  }
}

/**
 * Esiti di sicurezza e approvazione verso l'utente (D65, D142, D180): evento del tempo reale con
 * il solo esito e push con un testo discreto, mai la motivazione. Sanzioni e richiesta della
 * verifica dell'età non hanno un tipo di push nell'architettura: restano l'avviso all'email
 * personale e lo stato riletto dalle API (le sanzioni chiudono i canali dal loro servizio).
 */
@Injectable()
export class NotifyingUserEvents extends UserEvents {
  private readonly logger = new Logger(NotifyingUserEvents.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimePublisher,
  ) {
    super();
  }

  async emit(userId: string, type: UserEventType): Promise<void> {
    if (type !== 'approval.approved' && type !== 'approval.rejected') return;
    const outcome = type === 'approval.approved' ? 'approved' : 'rejected';
    // Dopo il commit della decisione: un errore dell'avviso non annulla la decisione, e l'esito
    // resta comunque nell'app (`GET /me/approval`) e nell'email personale
    try {
      await this.realtime.publish(userId, { type: 'approval', outcome });
      await this.notifications.notify({
        userId,
        type: 'approval',
        text: outcome === 'approved' ? 'approval.approved' : 'approval.notification',
      });
    } catch (error) {
      this.logger.warn(
        `Avviso dell'esito non inviato (${error instanceof Error ? error.message.split('\n')[0] : 'errore'})`,
      );
    }
  }
}
