/** Messaggio email in uscita: solo testo, nessun tracciamento (D101). */
export interface OutgoingEmail {
  to: string;
  /** Mittente: `neutral` per l'email aziendale (D101), `project` per l'email personale. */
  from: 'neutral' | 'project';
  subject: string;
  text: string;
}

/** Adattatore sostituibile dell'invio delle email (SMTP: Mailpit in locale, Brevo in produzione). */
export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
