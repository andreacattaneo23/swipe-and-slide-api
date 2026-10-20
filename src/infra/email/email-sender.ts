/** Messaggio email in uscita: solo testo, nessun tracciamento (D101). */
export interface OutgoingEmail {
  to: string;
  /** Mittente: `neutral` per l'email aziendale (D101), `project` per l'email personale. */
  from: 'neutral' | 'project';
  subject: string;
  text: string;
  /** Solo per l'adattatore di sviluppo: codice da mostrare nel log, mai nei log di produzione. */
  devCode?: string;
}

/** Adattatore sostituibile dell'invio delle email (Brevo in produzione, log in sviluppo). */
export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
