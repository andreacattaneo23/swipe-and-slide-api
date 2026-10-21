/**
 * Punto di chiamata verso notifiche push e tempo reale per gli esiti di sicurezza e approvazione
 * (D65, D180): l'implementazione è `NotifyingUserEvents`, con `NotificationsService.notify()` e
 * `RealtimePublisher`. Gli eventi contengono solo il tipo e gli identificativi; i testi discreti
 * li scelgono le notifiche (mai la motivazione, D142).
 */
export type UserEventType =
  | 'approval.approved'
  | 'approval.rejected'
  | 'sanction.decided'
  | 'sanction.ended'
  | 'age_verification.requested';

export abstract class UserEvents {
  abstract emit(userId: string, type: UserEventType): Promise<void>;
}
