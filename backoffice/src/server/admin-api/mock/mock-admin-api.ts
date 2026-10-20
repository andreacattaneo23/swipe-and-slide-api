/**
 * Adattatore `mock` delle API di amministrazione: dati finti in memoria, default finché
 * `admin-api` non c'è. Riproduce le regole che il backoffice deve rispettare, così i gestori lato
 * server si provano già adesso:
 * - accesso in due passi (codice all'email, 6 cifre, 10 minuti, 5 tentativi; poi TOTP) con la
 *   risposta uguale per ogni email (D88, D136);
 * - ruolo letto "dal database" a ogni richiesta, non dal token (D231);
 * - motivazione obbligatoria (D91), conferma rafforzata con nome e TOTP per la rimozione (D93),
 *   intervallo di 24 ore annullabile (D111, D120);
 * - nessun dato vietato nei DTO (D90): niente email in chiaro, preferenze, esclusioni, Open space.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { maskEmail } from '@/lib/mask-email';
import type { OperatorRole } from '@/lib/roles';
import {
  AdminApiError,
  REVIEW_REASONS,
  type AdminApi,
  type ApprovalDecision,
  type ApprovalDetail,
  type ApprovalQueue,
  type City,
  type Company,
  type CompanyInput,
  type Offsite,
  type OffsiteInput,
  type Operator,
  type OperatorSession,
  type RejectionDecision,
  type RemovalConfirmation,
  type RemovalPreview,
  type SignInChallenge,
} from '../types';
import devOperators from './dev-operators.json';
import { buildFixtures, type MockApproval } from './fixtures';

const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL_MS = 8 * 60 * 60_000;
const REMOVAL_INTERVAL_MS = 24 * 60 * 60_000;
const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

interface MockOperator extends Operator {
  email: string;
}

interface Challenge {
  operatorId: string | null;
  email: string;
  step: 'code' | 'totp';
  code: string;
  attempts: number;
  expiresAt: number;
}

interface Session {
  operatorId: string;
  expiresAt: number;
}

export interface MockOptions {
  /** Orologio simulato nei test. */
  now?: () => Date;
  /** Codice all'email: di base casuale e stampato sulla console del server (MOCK_SIGN_IN_CODE). */
  signInCode?: () => string;
  /** Dove "arriva" l'email con il codice. */
  deliverCode?: (email: string, code: string) => void;
  totpSecret?: string;
}

export class MockAdminApi implements AdminApi {
  private readonly now: () => Date;
  private readonly signInCode: () => string;
  private readonly deliverCode: (email: string, code: string) => void;
  private readonly totp: TOTP;
  private readonly operators: MockOperator[];
  private readonly challenges = new Map<string, Challenge>();
  private readonly sessions = new Map<string, Session>();
  private companies: Company[];
  private approvals: MockApproval[];
  private readonly offsites: Offsite[] = [];
  private readonly cities: City[];
  private readonly photosCount: number;

  constructor(options: MockOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.signInCode =
      options.signInCode ?? (() => String(randomInt(0, 1_000_000)).padStart(6, '0'));
    this.deliverCode =
      options.deliverCode ??
      ((email, code) => console.info(`[admin-api mock] codice di accesso per ${email}: ${code}`));
    this.totp = new TOTP({
      secret: Secret.fromBase32(options.totpSecret ?? devOperators.totpSecret),
      digits: 6,
      period: 30,
    });
    this.operators = devOperators.operators.map((item) => ({
      ...item,
      roles: item.roles as OperatorRole[],
    }));
    const fixtures = buildFixtures(this.now());
    this.companies = fixtures.companies;
    this.approvals = fixtures.approvals;
    this.cities = fixtures.cities;
    this.photosCount = fixtures.photosCount;
  }

  // ---------- Accesso ----------

  async requestSignInCode(email: string): Promise<SignInChallenge> {
    const normalized = email.trim().toLowerCase();
    const operator = this.operators.find((item) => item.email === normalized) ?? null;
    const challengeId = randomUUID();
    const code = this.signInCode();
    const expiresAt = this.now().getTime() + CODE_TTL_MS;
    this.challenges.set(challengeId, {
      operatorId: operator?.id ?? null,
      email: normalized,
      step: 'code',
      code,
      attempts: 0,
      expiresAt,
    });
    // Risposta uguale per ogni email: il codice parte solo verso un operatore.
    if (operator) this.deliverCode(operator.email, code);
    return { challengeId, maskedEmail: maskEmail(normalized), expiresAt: iso(expiresAt) };
  }

  async verifySignInCode(challengeId: string, code: string): Promise<SignInChallenge> {
    const challenge = this.liveChallenge(challengeId, 'code');
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) throw new AdminApiError('too_many_attempts');
    challenge.attempts += 1;
    if (!challenge.operatorId || code !== challenge.code) {
      const remainingAttempts = MAX_CODE_ATTEMPTS - challenge.attempts;
      if (remainingAttempts <= 0) throw new AdminApiError('too_many_attempts');
      throw new AdminApiError('invalid_code', { remainingAttempts });
    }
    challenge.step = 'totp';
    challenge.attempts = 0;
    return {
      challengeId,
      maskedEmail: maskEmail(challenge.email),
      expiresAt: iso(challenge.expiresAt),
    };
  }

  async verifyTotp(challengeId: string, totpCode: string): Promise<OperatorSession> {
    const challenge = this.liveChallenge(challengeId, 'totp');
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) throw new AdminApiError('too_many_attempts');
    challenge.attempts += 1;
    if (!this.validTotp(totpCode)) {
      throw new AdminApiError('invalid_totp', {
        remainingAttempts: MAX_CODE_ATTEMPTS - challenge.attempts,
      });
    }
    this.challenges.delete(challengeId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.now().getTime() + SESSION_TTL_MS;
    this.sessions.set(token, { operatorId: challenge.operatorId!, expiresAt });
    return {
      token,
      expiresAt: iso(expiresAt),
      operator: this.publicOperator(challenge.operatorId!),
    };
  }

  async getCurrentOperator(token: string): Promise<Operator> {
    return this.authorize(token, ['admin', 'moderator', 'support']);
  }

  async signOut(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  // ---------- Aziende ----------

  async listCompanies(token: string, search?: string): Promise<Company[]> {
    this.authorize(token, ['admin']);
    const query = search?.trim().toLowerCase();
    return this.companies
      .filter(
        (company) =>
          !query ||
          company.name.toLowerCase().includes(query) ||
          company.domains.some((domain) => domain.includes(query)),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'it'))
      .map(clone);
  }

  async createCompany(token: string, input: CompanyInput): Promise<Company> {
    this.authorize(token, ['admin']);
    requireExplanation(input.explanation);
    const name = input.name.trim();
    if (!name) throw new AdminApiError('validation', { field: 'name' });
    const domains = [...new Set(input.domains.map((domain) => domain.trim().toLowerCase()))];
    if (domains.length === 0 || domains.some((domain) => !DOMAIN_PATTERN.test(domain))) {
      throw new AdminApiError('validation', { field: 'domains' });
    }
    const taken = new Set(this.companies.flatMap((company) => company.domains));
    if (domains.some((domain) => taken.has(domain))) {
      throw new AdminApiError('conflict', { field: 'domains' });
    }
    const company: Company = {
      id: randomUUID(),
      name,
      status: 'active',
      isDemo: false,
      domains,
      usersCount: null,
      updatedAt: this.now().toISOString(),
      removalFinalAt: null,
    };
    this.companies.push(company);
    return clone(company);
  }

  async getRemovalPreview(token: string, companyId: string): Promise<RemovalPreview> {
    this.authorize(token, ['admin']);
    const company = this.company(companyId);
    return {
      companyId: company.id,
      name: company.name,
      domains: [...company.domains],
      accountsCount: company.usersCount ?? 0,
    };
  }

  async startRemoval(
    token: string,
    companyId: string,
    input: RemovalConfirmation,
  ): Promise<Company> {
    this.authorize(token, ['admin']);
    const company = this.company(companyId);
    requireExplanation(input.explanation);
    if (input.confirmName.trim() !== company.name) {
      throw new AdminApiError('validation', { field: 'confirmName' });
    }
    if (!this.validTotp(input.totpCode)) throw new AdminApiError('invalid_totp');
    if (company.status !== 'active') throw new AdminApiError('conflict');
    company.status = 'removing';
    company.removalFinalAt = iso(this.now().getTime() + REMOVAL_INTERVAL_MS);
    company.updatedAt = this.now().toISOString();
    return clone(company);
  }

  async cancelRemoval(token: string, companyId: string, input: ApprovalDecision): Promise<Company> {
    this.authorize(token, ['admin']);
    const company = this.company(companyId);
    requireExplanation(input.explanation);
    if (company.status !== 'removing') throw new AdminApiError('conflict');
    company.status = 'active';
    company.removalFinalAt = null;
    company.updatedAt = this.now().toISOString();
    return clone(company);
  }

  // ---------- Approvazioni ----------

  async getApprovalQueue(token: string): Promise<ApprovalQueue> {
    this.authorize(token, ['admin', 'moderator']);
    const profiles = [...this.approvals]
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .map(({ id, name, age, attempt, maxAttempts, submittedAt, dueAt, photos }) => ({
        id,
        name,
        age,
        attempt,
        maxAttempts,
        submittedAt,
        dueAt,
        photo: photos[0] ?? null,
      }));
    return { profiles, profilesCount: profiles.length, photosCount: this.photosCount };
  }

  async getApproval(token: string, reviewId: string): Promise<ApprovalDetail> {
    this.authorize(token, ['admin', 'moderator']);
    const found = this.approvals.find((item) => item.id === reviewId);
    if (!found) throw new AdminApiError('not_found');
    const { photos, ...rest } = found;
    return { ...rest, photo: photos[0] ?? null, photos: photos.map(clone) };
  }

  async approveProfile(token: string, reviewId: string, input: ApprovalDecision): Promise<void> {
    this.authorize(token, ['admin', 'moderator']);
    requireExplanation(input.explanation);
    this.takeApproval(reviewId);
  }

  async rejectProfile(token: string, reviewId: string, input: RejectionDecision): Promise<void> {
    this.authorize(token, ['admin', 'moderator']);
    if (!REVIEW_REASONS.includes(input.reason)) {
      throw new AdminApiError('validation', { field: 'reason' });
    }
    requireExplanation(input.explanation);
    this.takeApproval(reviewId);
  }

  // ---------- Offsite ----------

  async listCities(token: string): Promise<City[]> {
    this.authorize(token, ['admin']);
    return this.cities.map(clone);
  }

  async createOffsite(token: string, input: OffsiteInput): Promise<Offsite> {
    this.authorize(token, ['admin']);
    for (const field of ['title', 'venueName', 'venueAddress', 'cityId'] as const) {
      if (!input[field].trim()) throw new AdminApiError('validation', { field });
    }
    if (!this.cities.some((city) => city.id === input.cityId)) {
      throw new AdminApiError('validation', { field: 'cityId' });
    }
    const starts = Date.parse(input.startsAt);
    const ends = Date.parse(input.endsAt);
    if (Number.isNaN(starts) || Number.isNaN(ends) || ends <= starts) {
      throw new AdminApiError('validation', { field: 'endsAt' });
    }
    if (input.capacity !== null && (!Number.isInteger(input.capacity) || input.capacity < 1)) {
      throw new AdminApiError('validation', { field: 'capacity' });
    }
    const offsite: Offsite = {
      ...input,
      id: randomUUID(),
      status: 'draft',
      attendeesRounded: null,
    };
    this.offsites.push(offsite);
    return clone(offsite);
  }

  async publishOffsite(token: string, offsiteId: string): Promise<Offsite> {
    this.authorize(token, ['admin']);
    const offsite = this.offsites.find((item) => item.id === offsiteId);
    if (!offsite) throw new AdminApiError('not_found');
    if (offsite.status !== 'draft') throw new AdminApiError('conflict');
    offsite.status = 'published';
    return clone(offsite);
  }

  // ---------- Supporto ----------

  /** Sessione valida e ruolo ammesso, letto a ogni richiesta (D231). */
  private authorize(token: string, roles: readonly OperatorRole[]): Operator {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= this.now().getTime()) {
      this.sessions.delete(token);
      throw new AdminApiError('unauthorized');
    }
    const operator = this.publicOperator(session.operatorId);
    if (!operator.roles.some((role) => roles.includes(role))) {
      throw new AdminApiError('forbidden');
    }
    return operator;
  }

  private publicOperator(id: string): Operator {
    const found = this.operators.find((item) => item.id === id);
    if (!found) throw new AdminApiError('unauthorized');
    return { id: found.id, name: found.name, roles: [...found.roles] };
  }

  private liveChallenge(challengeId: string, step: Challenge['step']): Challenge {
    const challenge = this.challenges.get(challengeId);
    if (!challenge || challenge.step !== step) throw new AdminApiError('code_expired');
    if (challenge.expiresAt <= this.now().getTime()) {
      this.challenges.delete(challengeId);
      throw new AdminApiError('code_expired');
    }
    return challenge;
  }

  private validTotp(code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    return this.totp.validate({ token: code, timestamp: this.now().getTime(), window: 1 }) !== null;
  }

  private company(companyId: string): Company {
    const company = this.companies.find((item) => item.id === companyId);
    if (!company) throw new AdminApiError('not_found');
    return company;
  }

  private takeApproval(reviewId: string): void {
    const index = this.approvals.findIndex((item) => item.id === reviewId);
    if (index < 0) throw new AdminApiError('not_found');
    this.approvals.splice(index, 1);
  }

  /** Solo per i test: codice TOTP valido nell'istante dell'orologio simulato. */
  currentTotp(): string {
    return this.totp.generate({ timestamp: this.now().getTime() });
  }
}

function requireExplanation(explanation: string): void {
  if (!explanation.trim()) throw new AdminApiError('validation', { field: 'explanation' });
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
