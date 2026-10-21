import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { EmailSender, OutgoingEmail } from './email-sender';

/**
 * Invio via SMTP (D240): in locale Mailpit (`localhost:1025`, senza autenticazione), in
 * produzione il relay SMTP di Brevo (D117). Solo testo, nessun tracciamento, due mittenti
 * distinti: neutro per l'email aziendale e con il nome dell'app per la personale (D101).
 */
@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;

  constructor(
    options: {
      host: string;
      port: number;
      secure: boolean;
      user: string | null;
      password: string | null;
    },
    private readonly senders: { neutral: string; project: string },
  ) {
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user ? { auth: { user: options.user, pass: options.password ?? '' } } : {}),
      connectionTimeout: 10_000,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.senders[email.from],
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
  }
}
