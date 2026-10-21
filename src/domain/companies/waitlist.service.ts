import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { waitlistRequests } from '../../infra/database/schema-safety';
import { ApiError } from '../../infra/http/api-error';
import { isDisposable, isPersonalProvider, normalizeEmail } from '../email/email-address';
import { OtpService } from '../otp/otp.service';
import { CompaniesService } from './companies.service';

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Lista d'attesa dall'app (P13, D95): dominio dell'email aziendale (non l'indirizzo), nome
 * dell'azienda se indicato ed email di contatto confermata con un codice. Senza conferma la
 * richiesta scade dopo 24 ore, con la conferma dopo 90 giorni (D197). La risposta è uguale per
 * ogni dominio, anche già nell'elenco: il nome di un'azienda non è un dato riservato, ma così la
 * forma non cambia.
 */
@Injectable()
export class WaitlistService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly otp: OtpService,
    private readonly companies: CompaniesService,
  ) {}

  async request(
    input: { domain: string; suggestedName?: string; contactEmail: string },
    ip: string,
  ): Promise<void> {
    const domain = input.domain.trim().toLowerCase().replace(/\.+$/, '');
    const contact = normalizeEmail(input.contactEmail);
    if (!DOMAIN.test(domain) || !contact) throw ApiError.badRequest('validation');
    // Provider personali e usa e getta: si spiega l'email lavorativa, senza lista d'attesa
    if (isPersonalProvider(domain) || isDisposable(domain)) {
      throw ApiError.badRequest('registration.email.personal');
    }
    if (await this.companies.isListedDomain(domain)) return;
    await this.db
      .insert(waitlistRequests)
      .values({
        domain,
        suggestedName: input.suggestedName?.trim() || null,
        contactEmail: contact.email,
        expiresAt: sql`now() + interval '24 hours'`,
      })
      .onConflictDoUpdate({
        target: [waitlistRequests.domain, waitlistRequests.contactEmail],
        set: {
          suggestedName: input.suggestedName?.trim() || null,
          expiresAt: sql`greatest(${waitlistRequests.expiresAt}, now() + interval '24 hours')`,
        },
      });
    await this.otp.issue({ email: contact.email, purpose: 'waitlist', from: 'project', ip });
  }

  /** Conferma dell'email di contatto: le richieste in attesa valgono 90 giorni. */
  async confirm(contactEmail: string, code: string): Promise<void> {
    const contact = normalizeEmail(contactEmail);
    if (!contact) throw ApiError.badRequest('validation');
    await this.otp.verifyOrThrow(contact.email, 'waitlist', code);
    await this.db
      .update(waitlistRequests)
      .set({ contactConfirmedAt: sql`now()`, expiresAt: sql`now() + interval '90 days'` })
      .where(
        and(
          eq(waitlistRequests.contactEmail, contact.email),
          isNull(waitlistRequests.contactConfirmedAt),
        ),
      );
  }
}
