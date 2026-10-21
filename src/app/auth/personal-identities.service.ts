import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import { blockedHashes, personalIdentities, users } from '../../infra/database/schema';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import { CompaniesService } from '../../domain/companies/companies.service';
import { isDisposable, PRIVATE_RELAY_DOMAIN } from '../../domain/email/email-address';
import { SessionsService, SessionTokens, SignInMethod } from './sessions.service';

export type IdentityProviderName = 'apple' | 'google' | 'email';

export interface NewIdentity {
  provider: IdentityProviderName;
  subject: string;
  email: string;
  isPrivateRelay: boolean;
}

/** Giorni entro cui completare la registrazione (D82, D224). */
export const REGISTRATION_DAYS = 7;

const METHOD: Record<IdentityProviderName, SignInMethod> = {
  apple: 'apple',
  google: 'google',
  email: 'personal_email',
};

/**
 * Identità personali (D224): controlli dell'email personale (dominio dell'elenco, usa e getta,
 * impronte bloccate, email già usata), creazione dell'account senza azienda al passo 1, accesso
 * e ripresa della registrazione. Nessuna funzione della regola legge questa tabella.
 */
@Injectable()
export class PersonalIdentitiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly companies: CompaniesService,
    private readonly sessions: SessionsService,
  ) {}

  /** Impronta unica di un indirizzo, la stessa per identità, email aziendali e blocchi. */
  emailHash(email: string): string {
    return this.crypto.hash('email', email);
  }

  /** Controlli del dominio prima di qualsiasi invio o scrittura (passo 1). */
  async checkPersonalDomain(domain: string, viaProvider: boolean): Promise<void> {
    if (domain === PRIVATE_RELAY_DOMAIN) return;
    if (await this.companies.isListedDomain(domain)) {
      throw ApiError.badRequest(
        viaProvider ? ErrorCode.workAccount : ErrorCode.workEmailAsPersonal,
      );
    }
    if (isDisposable(domain)) throw ApiError.badRequest(ErrorCode.disposable);
  }

  async isBlocked(hash: string, tx: Executor = this.db): Promise<boolean> {
    const [row] = await tx
      .select({ hash: blockedHashes.hash })
      .from(blockedHashes)
      .where(and(eq(blockedHashes.hash, hash), gt(blockedHashes.expiresAt, sql`now()`)));
    return row !== undefined;
  }

  /** L'indirizzo appartiene già a un account, come email personale o aziendale (anche storica). */
  async hashInUse(hash: string, tx: Executor = this.db): Promise<boolean> {
    const result = await tx.execute<{ used: boolean }>(sql`
      select exists (select 1 from personal_identities where email_hash = ${hash})
          or exists (select 1 from work_emails where email_hash = ${hash}) as used`);
    return result.rows[0]?.used === true;
  }

  async findActive(provider: IdentityProviderName, subject: string, tx: Executor = this.db) {
    const [row] = await tx
      .select({
        userId: personalIdentities.userId,
        identityId: personalIdentities.id,
        status: users.status,
        createdAt: users.createdAt,
        isDemo: users.isDemo,
      })
      .from(personalIdentities)
      .innerJoin(users, eq(users.id, personalIdentities.userId))
      .where(
        and(
          eq(personalIdentities.provider, provider),
          eq(personalIdentities.subject, subject),
          isNull(personalIdentities.revokedAt),
        ),
      );
    return row ?? null;
  }

  /**
   * Accesso con un'identità già registrata. Una registrazione oltre i 7 giorni si cancella
   * subito e la risposta è come per un'identità senza account (`null`).
   */
  async signIn(provider: IdentityProviderName, subject: string): Promise<SessionTokens | null> {
    return this.db.transaction(async (tx) => {
      const identity = await this.findActive(provider, subject, tx);
      if (!identity) return null;
      // Gli account dimostrativi non hanno identità dei fornitori (D42, RC-209)
      if (identity.isDemo && provider !== 'email') return null;
      if (identity.status === 'registering' && this.registrationExpired(identity.createdAt)) {
        await tx.execute(sql`select delete_account(${identity.userId}::uuid)`);
        return null;
      }
      if (identity.status === 'deleted') return null;
      await tx
        .update(personalIdentities)
        .set({ lastSignInAt: sql`now()` })
        .where(eq(personalIdentities.id, identity.identityId));
      return this.sessions.create(identity.userId, METHOD[provider], tx);
    });
  }

  /**
   * Passo 1 con un'identità nuova: impronte bloccate ed email già usata dopo la verifica, poi
   * un'unica transazione che crea l'account `registering` senza azienda e l'identità.
   */
  async createAccount(identity: NewIdentity): Promise<SessionTokens> {
    const hash = this.emailHash(identity.email);
    if (await this.isBlocked(hash)) throw ApiError.badRequest(ErrorCode.registrationBlocked);
    if (await this.hashInUse(hash)) throw ApiError.conflict(ErrorCode.emailInUse);
    return this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ isDemo: false }).returning({ id: users.id });
      await tx.insert(personalIdentities).values({
        userId: user!.id,
        provider: identity.provider,
        subject: identity.provider === 'email' ? hash : identity.subject,
        email: identity.email,
        emailHash: hash,
        emailVerifiedAt: sql`now()`,
        isPrivateRelay: identity.isPrivateRelay,
        lastSignInAt: sql`now()`,
      });
      return this.sessions.create(user!.id, METHOD[identity.provider], tx);
    });
  }

  /**
   * Account con l'email aziendale attiva indicata (accesso con l'email, D82), se la persona non
   * ha spento l'accesso con l'email aziendale (D233).
   */
  async userByActiveWorkEmail(email: string): Promise<string | null> {
    const result = await this.db.execute<{ user_id: string }>(sql`
      select w.user_id from work_emails w join users x on x.id = w.user_id
       where w.email_hash = ${this.emailHash(email)} and w.status = 'active' and x.work_email_sign_in`);
    return result.rows[0]?.user_id ?? null;
  }

  /** Identità di qualsiasi fornitore con questa email personale. */
  async identityByEmail(email: string) {
    const [row] = await this.db
      .select({
        provider: personalIdentities.provider,
        subject: personalIdentities.subject,
        userId: personalIdentities.userId,
      })
      .from(personalIdentities)
      .where(
        and(
          eq(personalIdentities.emailHash, this.emailHash(email)),
          isNull(personalIdentities.revokedAt),
        ),
      );
    return row ?? null;
  }

  registrationExpired(createdAt: Date): boolean {
    return Date.now() - createdAt.getTime() > REGISTRATION_DAYS * 24 * 60 * 60 * 1000;
  }
}
