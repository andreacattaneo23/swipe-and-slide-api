import { Injectable, Logger } from '@nestjs/common';
import { EmailSender, OutgoingEmail } from './email-sender';

/**
 * Adattatore di sviluppo: l'email non parte, il codice si scrive nel log. Vietato in produzione
 * (lo impedisce `loadConfig`). Nei test conserva l'ultimo codice per ogni destinatario.
 */
@Injectable()
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('Email');
  readonly sent: OutgoingEmail[] = [];

  send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    this.logger.log(
      `[sviluppo] email a ${email.to} (${email.from}): "${email.subject}"` +
        (email.devCode ? ` codice ${email.devCode}` : ''),
    );
    return Promise.resolve();
  }

  /** Ultimo codice inviato a un indirizzo (solo test e sviluppo). */
  lastCodeFor(to: string): string | undefined {
    return [...this.sent].reverse().find((email) => email.to === to)?.devCode;
  }
}
