import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, Database } from '../../infra/database/database';
import { accountEmails } from '../../infra/email/account-email-texts';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import { AccountMailer } from '../../domain/account/account-mailer';
import { normalizeEmail, PRIVATE_RELAY_DOMAIN } from '../../domain/email/email-address';
import { OtpService } from '../../domain/otp/otp.service';
import { PersonalIdentitiesService } from '../auth/personal-identities.service';
import { ProviderSignInService } from '../auth/provider-sign-in.service';

/** Scopi della conferma dell'identità legata alla sessione (D233). */
export type ConfirmationPurpose = 'company_change' | 'access_change';

/** Validità della conferma dell'identità: pochi minuti [Proposta]. */
const CONFIRMATION_MINUTES = 10;

export interface AccessInfo {
  provider: 'apple' | 'google' | 'email' | null;
  personalEmail: string | null;
  isPrivateRelay: boolean;
  workEmail: string | null;
  workEmailSignIn: boolean;
}

/**
 * "Email e accesso" (D82, D224, D233): conferma dell'identità con un codice all'email personale
 * attuale (anche nascosta di Apple), cambio del modo di accesso e dell'email personale con gli
 * stessi controlli del passo 1, accesso con l'email aziendale acceso o spento. Nessuna funzione
 * della regola legge l'identità: azienda, Open space, aziende escluse e match non cambiano.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly otp: OtpService,
    private readonly identities: PersonalIdentitiesService,
    private readonly providers: ProviderSignInService,
    private readonly mailer: AccountMailer,
  ) {}

  async info(userId: string): Promise<AccessInfo> {
    const result = await this.db.execute<{
      provider: AccessInfo['provider'];
      email: string | null;
      is_private_relay: boolean | null;
      work_email: string | null;
      work_email_sign_in: boolean;
    }>(sql`
      select i.provider, i.email, i.is_private_relay, w.email as work_email, x.work_email_sign_in
        from users x
        left join personal_identities i on i.user_id = x.id and i.revoked_at is null
        left join work_emails w on w.user_id = x.id and w.status = 'active'
       where x.id = ${userId}::uuid`);
    const row = result.rows[0];
    if (!row) throw ApiError.notFound();
    return {
      provider: row.provider,
      personalEmail: row.email,
      isPrivateRelay: row.is_private_relay ?? false,
      workEmail: row.work_email,
      workEmailSignIn: row.work_email_sign_in,
    };
  }

  async setWorkEmailSignIn(userId: string, enabled: boolean): Promise<AccessInfo> {
    await this.db.execute(
      sql`update users set work_email_sign_in = ${enabled} where id = ${userId}::uuid`,
    );
    return this.info(userId);
  }

  /** Codice all'email personale attuale, qualunque sia il modo di accesso (D233). */
  async sendConfirmationCode(
    userId: string,
    purpose: ConfirmationPurpose,
    ip: string,
  ): Promise<void> {
    const email = await this.mailer.personalEmail(userId);
    if (!email) throw ApiError.forbidden();
    await this.otp.issue({ email, purpose: this.otpPurpose(purpose), from: 'project', ip, userId });
  }

  async confirm(
    userId: string,
    sessionId: string,
    purpose: ConfirmationPurpose,
    code: string,
  ): Promise<void> {
    const email = await this.mailer.personalEmail(userId);
    if (!email) throw ApiError.forbidden();
    await this.otp.verifyOrThrow(email, this.otpPurpose(purpose), code);
    await this.db.execute(sql`
      update sessions set identity_confirmed_at = now(), identity_confirmed_for = ${purpose}
       where id = ${sessionId}::uuid and user_id = ${userId}::uuid`);
  }

  /** La conferma vale pochi minuti, per lo scopo indicato e solo nella sessione che l'ha fatta. */
  async requireConfirmation(sessionId: string, purpose: ConfirmationPurpose): Promise<void> {
    const result = await this.db.execute<{ ok: boolean }>(sql`
      select (identity_confirmed_for = ${purpose}
              and identity_confirmed_at > now() - make_interval(mins => ${CONFIRMATION_MINUTES})) is true as ok
        from sessions where id = ${sessionId}::uuid`);
    if (result.rows[0]?.ok !== true) throw new ApiError(403, 'identity.confirmation.required');
  }

  /** Codice alla nuova email personale per il cambio del modo di accesso o dell'email. */
  async sendNewEmailCode(userId: string, input: string, ip: string): Promise<void> {
    const email = this.normalize(input);
    await this.identities.checkPersonalDomain(email.domain, false);
    await this.otp.issue({
      email: email.email,
      purpose: 'personal_email',
      from: 'project',
      ip,
      userId,
    });
  }

  /**
   * Cambio del modo di accesso (Proposta 1, D233): verifica della nuova identità con i controlli
   * del passo 1, poi in un'unica transazione la nuova identità diventa attiva e la vecchia si
   * cancella, con il suo eventuale token nella coda della revoca (RC-204).
   */
  async changeMethod(
    userId: string,
    sessionId: string,
    input:
      | { provider: 'apple' | 'google'; identityToken?: string; nonce?: string }
      | { provider: 'email'; email?: string; code?: string },
  ): Promise<AccessInfo> {
    await this.requireConfirmation(sessionId, 'access_change');
    let identity: {
      provider: 'apple' | 'google' | 'email';
      subject: string;
      email: string;
      isPrivateRelay: boolean;
    };
    if (input.provider === 'email') {
      if (!input.email || !input.code) throw ApiError.badRequest(ErrorCode.validation);
      const email = this.normalize(input.email);
      await this.identities.checkPersonalDomain(email.domain, false);
      await this.otp.verifyOrThrow(email.email, 'personal_email', input.code);
      const hash = this.identities.emailHash(email.email);
      identity = { provider: 'email', subject: hash, email: email.email, isPrivateRelay: false };
    } else {
      identity = await this.providers.verify(input.provider, input.identityToken, input.nonce);
      const email = normalizeEmail(identity.email);
      if (!email) throw new ApiError(401, ErrorCode.providerToken);
      if (!(identity.isPrivateRelay && email.domain === PRIVATE_RELAY_DOMAIN)) {
        try {
          await this.identities.checkPersonalDomain(email.domain, true);
        } catch {
          throw ApiError.badRequest('settings.access.change.workAccount');
        }
      }
      identity = { ...identity, email: email.email };
    }
    const hash = this.identities.emailHash(identity.email);
    if (await this.identities.isBlocked(hash))
      throw ApiError.badRequest(ErrorCode.registrationBlocked);
    const oldEmail = await this.mailer.personalEmail(userId);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from users where id = ${userId}::uuid for update`);
      const current = await tx.execute<{ id: string; provider: string; subject: string }>(sql`
        select id, provider, subject from personal_identities
         where user_id = ${userId}::uuid and revoked_at is null`);
      const old = current.rows[0];
      if (old && old.provider === identity.provider && old.subject === identity.subject) {
        throw ApiError.conflict('settings.access.method.same');
      }
      const taken = await tx.execute<{ taken: boolean }>(sql`
        select exists (select 1 from personal_identities
                        where user_id <> ${userId}::uuid
                          and ((provider = ${identity.provider}::identity_provider and subject = ${identity.subject})
                               or email_hash = ${hash}))
            or exists (select 1 from work_emails where email_hash = ${hash}) as taken`);
      if (taken.rows[0]?.taken) throw ApiError.conflict('settings.access.change.inUse');
      // Il token della vecchia identità entra nella coda della revoca, senza legame con l'account
      await tx.execute(sql`
        insert into provider_token_revocations (provider, token_ciphertext, key_version)
        select provider, refresh_token_ciphertext, refresh_token_key_version from personal_identities
         where user_id = ${userId}::uuid and refresh_token_ciphertext is not null`);
      await tx.execute(sql`delete from personal_identities where user_id = ${userId}::uuid`);
      await tx.execute(sql`
        insert into personal_identities (user_id, provider, subject, email, email_hash, email_verified_at,
                                         is_private_relay, last_sign_in_at)
        values (${userId}::uuid, ${identity.provider}::identity_provider, ${identity.subject},
                ${identity.email}, ${hash}, now(), ${identity.isPrivateRelay}, now())`);
      await tx.execute(sql`
        update sessions set identity_confirmed_at = null, identity_confirmed_for = null
         where id = ${sessionId}::uuid`);
    });
    await this.notifyBoth(oldEmail, identity.email, accountEmails.signInMethodChanged());
    return this.info(userId);
  }

  /** Cambio dell'email personale (D82), solo per chi accede con l'email: codici su vecchia e nuova. */
  async requestPersonalEmailChange(userId: string, input: string, ip: string): Promise<void> {
    const current = await this.emailIdentity(userId);
    const email = this.normalize(input);
    if (email.email === current.email) throw ApiError.conflict('settings.access.method.same');
    try {
      await this.identities.checkPersonalDomain(email.domain, false);
    } catch {
      throw ApiError.badRequest('settings.access.personalEmail.workEmail');
    }
    await this.otp.issue({
      email: current.email,
      purpose: 'personal_email',
      from: 'project',
      ip,
      userId,
    });
    await this.otp.issue({
      email: email.email,
      purpose: 'personal_email',
      from: 'project',
      ip,
      userId,
    });
  }

  async verifyPersonalEmailChange(
    userId: string,
    input: { email: string; oldCode: string; newCode: string },
  ): Promise<AccessInfo> {
    const current = await this.emailIdentity(userId);
    const email = this.normalize(input.email);
    await this.otp.verifyOrThrow(current.email, 'personal_email', input.oldCode);
    await this.otp.verifyOrThrow(email.email, 'personal_email', input.newCode);
    const hash = this.identities.emailHash(email.email);
    if (await this.identities.isBlocked(hash))
      throw ApiError.badRequest(ErrorCode.registrationBlocked);
    if (await this.identities.hashInUse(hash)) {
      throw ApiError.conflict('settings.access.personalEmail.inUse');
    }
    await this.db.execute(sql`
      update personal_identities set email = ${email.email}, email_hash = ${hash}, subject = ${hash},
             email_verified_at = now()
       where id = ${current.id}::uuid`);
    await this.notifyBoth(current.email, email.email, accountEmails.personalEmailChanged());
    return this.info(userId);
  }

  private async emailIdentity(userId: string): Promise<{ id: string; email: string }> {
    const result = await this.db.execute<{ id: string; email: string; provider: string }>(sql`
      select id, email, provider from personal_identities
       where user_id = ${userId}::uuid and revoked_at is null`);
    const row = result.rows[0];
    if (!row || row.provider !== 'email') {
      throw ApiError.conflict('settings.access.personalEmail.onlyEmail');
    }
    return row;
  }

  private async notifyBoth(
    oldEmail: string | null,
    newEmail: string,
    message: { subject: string; text: string },
  ): Promise<void> {
    if (oldEmail && oldEmail !== newEmail) await this.mailer.toAddress(oldEmail, message);
    await this.mailer.toAddress(newEmail, message);
  }

  private normalize(input: string): { email: string; domain: string } {
    const email = normalizeEmail(input);
    if (!email) throw ApiError.badRequest(ErrorCode.validation);
    return email;
  }

  private otpPurpose(purpose: ConfirmationPurpose): 'company_change' | 'personal_email' {
    return purpose === 'company_change' ? 'company_change' : 'personal_email';
  }
}
