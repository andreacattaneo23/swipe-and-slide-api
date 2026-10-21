/**
 * Punto di chiamata delle notifiche push del profilo e dell'account (D65, D114): promemoria della
 * ri-verifica e promemoria OOO. L'implementazione è il servizio delle notifiche (preferenze,
 * "Modalità in riunione", Expo Push), che si collega a questo token all'unione dei moduli; senza
 * un'implementazione non parte nessuna push e restano l'avviso nell'app e l'email personale.
 */
export interface AccountNotifier {
  notify(userId: string, type: 'reverification' | 'ooo_reminder'): Promise<void>;
}

export const ACCOUNT_NOTIFIER = Symbol('ACCOUNT_NOTIFIER');
