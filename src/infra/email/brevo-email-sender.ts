import { Injectable } from '@nestjs/common';
import { EmailSender, OutgoingEmail } from './email-sender';

/**
 * Invio con l'API transazionale di Brevo (D117), due mittenti (D101). [Proposta] Coda di invio,
 * nuovi tentativi e webhook delle email respinte restano da fare.
 */
@Injectable()
export class BrevoEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly senders: { neutral: string; project: string },
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: this.senders[email.from] },
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Brevo: invio non riuscito (${response.status})`);
  }
}
