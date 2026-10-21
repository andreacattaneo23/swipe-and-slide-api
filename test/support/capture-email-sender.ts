import { type EmailSender, type OutgoingEmail } from '../../src/infra/email/email-sender';

/**
 * Doppio di prova dell'invio delle email, definito solo nei test (D240): conserva i messaggi per
 * le suite che non passano da Mailpit. Il codice dell'applicazione invia sempre via SMTP.
 */
export class CaptureEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];

  send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }

  /** Ultimo codice inviato a un indirizzo. */
  lastCodeFor(to: string): string | undefined {
    const text = [...this.sent].reverse().find((email) => email.to === to)?.text;
    return text?.match(/\b(\d{6})\b/)?.[1];
  }
}
