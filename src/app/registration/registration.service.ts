import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DATABASE, Database, Executor } from '../../infra/database/database';
import {
  cities,
  consents,
  excludedCompanies,
  profiles,
  users,
  workEmails,
} from '../../infra/database/schema';
import { ApiError, ErrorCode } from '../../infra/http/api-error';
import { CoreRuleService } from '../../core/core-rule/core-rule.service';
import { ApprovalsService } from '../../domain/approvals/approvals.service';
import { CompaniesService } from '../../domain/companies/companies.service';
import { isDisposable, isPersonalProvider, normalizeEmail } from '../../domain/email/email-address';
import { OtpService } from '../../domain/otp/otp.service';
import { PersonalIdentitiesService, REGISTRATION_DAYS } from '../auth/personal-identities.service';
import { WordFilterService } from '../../domain/safety/word-filter.service';
import { SessionsService } from '../auth/sessions.service';
import {
  BirthDateDto,
  CompleteResultDto,
  ConsentDto,
  OpenSpaceChoiceDto,
  PrivacyDto,
  RegistrationProfileDto,
  RegistrationStateDto,
  RegistrationStep,
  WorkEmailDto,
  WorkEmailVerifyDto,
} from './registration.dto';

/** Passi obbligatori nel loro ordine (D224, D236); "privacy" è facoltativo. */
const MANDATORY: RegistrationStep[] = [
  'account',
  'birthDate',
  'workEmail',
  'consent',
  'profile',
  'openSpace',
];

/** Giorni tra la verifica dell'email aziendale e la ri-verifica (D20). */
const REVERIFICATION_DAYS = 90;

interface UserState {
  id: string;
  createdAt: Date;
  completed: Set<RegistrationStep>;
}

/**
 * I sette passi della registrazione (architettura, "Registrazione e accesso"), salvati uno per
 * uno: ogni passo si accetta solo dopo i passi obbligatori che lo precedono e lo stato si ricava
 * dai dati già scritti. Solo in `registering`; alla fine l'account va in `pending_approval`.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly identities: PersonalIdentitiesService,
    private readonly companies: CompaniesService,
    private readonly otp: OtpService,
    private readonly coreRule: CoreRuleService,
    private readonly approvals: ApprovalsService,
    private readonly sessions: SessionsService,
    private readonly words: WordFilterService,
  ) {}

  async state(userId: string): Promise<RegistrationStateDto> {
    const user = await this.load(userId);
    return this.describe(user);
  }

  /** Passo 2: maggiore età prima di scrivere; sotto i 18 anni non resta nulla (D76, D224). */
  async birthDate(userId: string, body: BirthDateDto): Promise<RegistrationStateDto> {
    const user = await this.load(userId, 'birthDate');
    const age = await this.db.execute<{ age: number }>(
      sql`select age_years(${body.birthDate}::date) as age`,
    );
    if ((age.rows[0]?.age ?? 0) < 18) {
      // Account, identità e sessioni si cancellano nella stessa richiesta; nessun consenso scritto.
      // [Proposta] La revoca immediata del token del fornitore (coda già scritta) è da fare.
      await this.db.execute(sql`select delete_account(${userId}::uuid)`);
      throw ApiError.badRequest(ErrorCode.underage);
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_registration_birth_date(${userId}::uuid, ${body.birthDate}::date)`,
      );
      await this.replaceConsent(tx, userId, 'terms', body.termsVersion);
    });
    return this.describe(await this.load(user.id));
  }

  /**
   * Passo 3, prima parte: dominio dell'elenco **prima** di qualsiasi invio; codice dal mittente
   * neutro con la stessa risposta qualunque sia lo stato dell'indirizzo (D101, D224).
   */
  async requestWorkEmailCode(userId: string, body: WorkEmailDto, ip: string): Promise<void> {
    await this.load(userId, 'workEmail');
    const email = await this.workEmailCompany(body.email);
    await this.otp.issue({
      email: email.email,
      purpose: 'registration',
      from: 'neutral',
      ip,
      userId,
    });
  }

  /**
   * Passo 3, verifica: solo ora impronte bloccate ed email già usata; poi, in un'unica
   * transazione, email aziendale attiva, azienda dell'account e dichiarazione P7.
   */
  async verifyWorkEmail(userId: string, body: WorkEmailVerifyDto): Promise<RegistrationStateDto> {
    await this.load(userId, 'workEmail');
    const email = await this.workEmailCompany(body.email);
    await this.otp.verifyOrThrow(email.email, 'registration', body.code);
    const hash = this.identities.emailHash(email.email);
    if (await this.identities.isBlocked(hash))
      throw ApiError.badRequest(ErrorCode.registrationBlocked);
    await this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      const [own] = await tx
        .select({ id: workEmails.id })
        .from(workEmails)
        .where(and(eq(workEmails.userId, userId), eq(workEmails.emailHash, hash)));
      if (!own && (await this.identities.hashInUse(hash, tx))) {
        throw ApiError.conflict(ErrorCode.workEmailInUse);
      }
      // Il dominio si ricontrolla nel database dentro la transazione (D229)
      const company = await this.companies.findActiveByDomain(email.domain, tx);
      if (!company || company.isDemo) throw ApiError.badRequest(ErrorCode.domainNotListed);
      // Ripetendo il passo 3 la nuova email sostituisce quella appena verificata
      await tx.delete(workEmails).where(eq(workEmails.userId, userId));
      await tx
        .delete(excludedCompanies)
        .where(
          and(eq(excludedCompanies.userId, userId), eq(excludedCompanies.companyId, company.id)),
        );
      await tx.insert(workEmails).values({
        userId,
        companyId: company.id,
        domain: email.domain,
        email: email.email,
        emailHash: hash,
        status: 'active',
        verifiedAt: sql`now()`,
        nextReverificationAt: sql`now() + make_interval(days => ${REVERIFICATION_DAYS})`,
      });
      await tx.update(users).set({ companyId: company.id }).where(eq(users.id, userId));
      await this.replaceConsent(tx, userId, 'p7_declaration', body.declarationVersion);
    });
    return this.describe(await this.load(userId));
  }

  /** Passo 4: consenso esplicito art. 9 prima di qualsiasi dato sull'orientamento (D33). */
  async consent(userId: string, body: ConsentDto): Promise<RegistrationStateDto> {
    await this.load(userId, 'consent');
    await this.db.transaction((tx) => this.replaceConsent(tx, userId, 'art9', body.textVersion));
    return this.describe(await this.load(userId));
  }

  /** Passo 5: dati di base del profilo; "chi ti interessa" solo dopo il consenso (D47). */
  async profile(userId: string, body: RegistrationProfileDto): Promise<RegistrationStateDto> {
    await this.load(userId, 'profile');
    const [city] = await this.db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.id, body.homeCityId), eq(cities.isActive, true)));
    if (!city) throw ApiError.badRequest('registration.city.invalid');
    // Filtro delle parole anche sul nome in registrazione (D73)
    for (const text of [body.firstName, body.lastName]) {
      if (!(await this.words.isAllowed(text))) throw new ApiError(422, 'profile.text.rejected');
    }
    // Preferenze di base: età dell'utente meno 5 e più 5, mai sotto 18 (D51, D197)
    await this.db
      .update(profiles)
      .set({
        firstName: body.firstName.trim(),
        lastName: body.lastName?.trim() ?? null,
        gender: body.gender,
        interestedIn: body.interestedIn,
        homeCityId: body.homeCityId,
        ageMin: sql`greatest(18, least(99, age_years(${profiles.birthDate}) - 5))`,
        ageMax: sql`greatest(18, least(99, age_years(${profiles.birthDate}) + 5))`,
      })
      .where(eq(profiles.userId, userId));
    return this.describe(await this.load(userId));
  }

  /** Passo 6, "Colleghi, solo se vuoi": scelta obbligata, vale subito e fuori dal limite (D156). */
  async openSpace(userId: string, body: OpenSpaceChoiceDto): Promise<RegistrationStateDto> {
    await this.load(userId, 'openSpace');
    await this.db.transaction((tx) =>
      this.coreRule.setOpenSpace(userId, body.enabled, 'registration', body.textVersion, tx),
    );
    return this.describe(await this.load(userId));
  }

  /** Passo 7, "Privacy": aziende escluse scritte subito, senza modifiche in attesa (D40, D175). */
  async privacy(userId: string, body: PrivacyDto): Promise<RegistrationStateDto> {
    await this.load(userId, 'privacy');
    await this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx.delete(excludedCompanies).where(eq(excludedCompanies.userId, userId));
      if (body.companyIds.length) {
        const valid = await this.validExclusions(tx, userId, body.companyIds);
        if (valid !== body.companyIds.length)
          throw ApiError.badRequest('excludedCompanies.invalid');
        await tx.insert(excludedCompanies).values(
          body.companyIds.map((companyId) => ({
            userId,
            companyId,
            source: 'registration' as const,
          })),
        );
      }
    });
    return this.describe(await this.load(userId));
  }

  /** Fine: tutti i passi obbligatori, poi `pending_approval` con la revisione a 24 ore (D141). */
  async complete(userId: string, sessionId: string): Promise<CompleteResultDto> {
    const user = await this.load(userId, 'complete');
    for (const step of MANDATORY) {
      if (!user.completed.has(step))
        throw ApiError.conflict(ErrorCode.stepOrder, { missing: step });
    }
    return this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx.update(users).set({ status: 'pending_approval' }).where(eq(users.id, userId));
      const review = await this.approvals.submit(userId, tx);
      const token = await this.sessions.reissue(userId, sessionId, tx);
      return { status: 'pending_approval' as const, reviewDueAt: review.dueAt, ...token };
    });
  }

  /**
   * Carica l'account in registrazione e controlla l'ordine: `step` si accetta solo con tutti i
   * passi obbligatori precedenti. Oltre i 7 giorni la registrazione si cancella (D82).
   */
  private async load(userId: string, step?: RegistrationStep | 'complete'): Promise<UserState> {
    const [user] = await this.db
      .select({ id: users.id, status: users.status, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.status !== 'registering') throw ApiError.forbidden();
    if (this.identities.registrationExpired(user.createdAt)) {
      await this.db.execute(sql`select delete_account(${userId}::uuid)`);
      throw new ApiError(401, ErrorCode.registrationExpired);
    }
    const completed = await this.completedSteps(userId);
    if (step && step !== 'account') {
      const before =
        step === 'complete' ? [] : MANDATORY.slice(0, Math.max(0, MANDATORY.indexOf(step)));
      const required = step === 'privacy' ? MANDATORY : before;
      const missing = required.find((needed) => !completed.has(needed));
      if (missing) throw ApiError.conflict(ErrorCode.stepOrder, { missing });
    }
    return { id: user.id, createdAt: user.createdAt, completed };
  }

  /** Stato dei passi ricavato dai dati già scritti, senza colonne in più. */
  private async completedSteps(userId: string): Promise<Set<RegistrationStep>> {
    const result = await this.db.execute<Record<string, boolean>>(sql`
      select
        exists (select 1 from profiles where user_id = ${userId}::uuid)
          and exists (select 1 from consents where user_id = ${userId}::uuid and type = 'terms') as "birthDate",
        exists (select 1 from work_emails where user_id = ${userId}::uuid and status = 'active')
          and exists (select 1 from consents where user_id = ${userId}::uuid and type = 'p7_declaration') as "workEmail",
        exists (select 1 from consents where user_id = ${userId}::uuid and type = 'art9' and revoked_at is null) as "consent",
        exists (select 1 from profiles where user_id = ${userId}::uuid and first_name is not null
                  and gender is not null and interested_in is not null and home_city_id is not null) as "profile",
        exists (select 1 from open_space_history where user_id = ${userId}::uuid and source = 'registration') as "openSpace",
        exists (select 1 from excluded_companies where user_id = ${userId}::uuid and source = 'registration') as "privacy"`);
    const row = result.rows[0] ?? {};
    const steps = new Set<RegistrationStep>(['account']);
    for (const step of [
      'birthDate',
      'workEmail',
      'consent',
      'profile',
      'openSpace',
      'privacy',
    ] as const) {
      if (row[step] === true) steps.add(step);
    }
    return steps;
  }

  private describe(user: UserState): RegistrationStateDto {
    const missing = MANDATORY.find((step) => !user.completed.has(step));
    const nextStep = missing ?? (user.completed.has('privacy') ? 'complete' : 'privacy');
    return {
      completedSteps: [...user.completed],
      nextStep,
      expiresAt: new Date(user.createdAt.getTime() + REGISTRATION_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  /** Email aziendale con un dominio dell'elenco, controllata prima di ogni invio (RC-05, RC-46). */
  private async workEmailCompany(input: string): Promise<{ email: string; domain: string }> {
    const email = normalizeEmail(input);
    if (!email) throw ApiError.badRequest(ErrorCode.validation);
    if (isPersonalProvider(email.domain) || isDisposable(email.domain)) {
      throw ApiError.badRequest(ErrorCode.workEmailPersonal);
    }
    const company = await this.companies.findActiveByDomain(email.domain);
    // Un'azienda dimostrativa non si raggiunge dalla registrazione (D42)
    if (!company || company.isDemo) throw ApiError.badRequest(ErrorCode.domainNotListed);
    return email;
  }

  /** Una riga per tipo e utente: ripetendo il passo si registra la nuova versione del testo. */
  private async replaceConsent(
    tx: Executor,
    userId: string,
    type: 'terms' | 'p7_declaration' | 'art9',
    textVersion: string,
  ): Promise<void> {
    await tx
      .delete(consents)
      .where(and(eq(consents.userId, userId), eq(consents.type, type), isNull(consents.revokedAt)));
    await tx.insert(consents).values({ userId, type, textVersion });
  }

  /** Aziende ammesse: attive, dello stesso tipo, diverse dalla propria (RC-40). */
  private async validExclusions(
    tx: Executor,
    userId: string,
    companyIds: string[],
  ): Promise<number> {
    const rows = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from companies z, users x
       where x.id = ${userId}::uuid and z.id in (${sql.join(
         companyIds.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
         and z.status = 'active' and z.is_demo = x.is_demo and z.id is distinct from x.company_id`);
    return rows.rows[0]?.n ?? 0;
  }
}
