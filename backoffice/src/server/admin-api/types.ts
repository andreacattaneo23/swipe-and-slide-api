/**
 * Contratto del client delle API di amministrazione (`admin-api`, rotte `/backoffice/*`
 * dell'architettura). Il backoffice usa solo questa interfaccia; gli adattatori sono `mock`
 * (dati in memoria) e `http` (verso ADMIN_API_URL). Quando esiste `openapi/admin.json` i tipi si
 * generano dal contratto e questo file diventa un adattamento sottile.
 *
 * Nessun DTO contiene email in chiaro, "chi ti interessa", aziende escluse, blocchi o stato
 * dell'Open space (D90); le date viaggiano come stringhe ISO 8601.
 */
import type { OperatorRole } from '@/lib/roles';

export interface Operator {
  id: string;
  name: string;
  roles: OperatorRole[];
}

/** Passo dell'accesso: codice all'email (`operator`) e poi TOTP (D88). */
export interface SignInChallenge {
  challengeId: string;
  /** Email dell'operatore già mascherata da admin-api (D90). */
  maskedEmail: string;
  expiresAt: string;
}

export interface OperatorSession {
  /** JWT breve emesso da admin-api dopo OTP e TOTP; non arriva mai al browser (D231). */
  token: string;
  expiresAt: string;
  operator: Operator;
}

// ---------- Aziende (D84, D85, D93, D111, D120) ----------

export type CompanyStatus = 'active' | 'removing';

export interface Company {
  id: string;
  name: string;
  status: CompanyStatus;
  isDemo: boolean;
  domains: string[];
  /** Numero di utenti; null sotto la soglia di 10 persone delle statistiche (D89). */
  usersCount: number | null;
  updatedAt: string;
  /** Fine dell'intervallo di rimozione, solo con status `removing`. */
  removalFinalAt: string | null;
}

export interface CompanyInput {
  name: string;
  domains: string[];
  explanation: string;
}

export interface RemovalPreview {
  companyId: string;
  name: string;
  domains: string[];
  accountsCount: number;
}

/** Conferma rafforzata: motivazione, nome digitato e TOTP appena generato (D91, D93). */
export interface RemovalConfirmation {
  explanation: string;
  confirmName: string;
  totpCode: string;
}

// ---------- Approvazioni (D141–D144) ----------

export type PhotoPlaceholder = 'terracotta' | 'sage' | 'sand';

export interface PhotoRef {
  id: string;
  /** URL firmato di breve durata; null nei dati finti (si mostra la sagoma). */
  url: string | null;
  placeholder: PhotoPlaceholder;
}

export interface ApprovalSummary {
  id: string;
  name: string;
  age: number;
  attempt: number;
  maxAttempts: number;
  submittedAt: string;
  dueAt: string;
  photo: PhotoRef | null;
}

/** Solo ciò che serve alla revisione: mai preferenze, aziende escluse né Open space (D90). */
export interface ApprovalDetail extends ApprovalSummary {
  photos: PhotoRef[];
  practiceArea: string | null;
  lookingFor: string | null;
  bio: string | null;
}

export interface ApprovalQueue {
  profiles: ApprovalSummary[];
  profilesCount: number;
  photosCount: number;
}

/** Motivi del rifiuto [Proposta] (elenco di D197). */
export const REVIEW_REASONS = [
  'non_compliant_photo',
  'inappropriate_photos',
  'fake_profile',
  'disallowed_text',
  'reveals_company_or_clients',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export interface ApprovalDecision {
  explanation: string;
}

export interface RejectionDecision extends ApprovalDecision {
  reason: ReviewReason;
}

// ---------- Offsite (D150, D153, D167) ----------

export type OffsiteStatus = 'draft' | 'published' | 'cancelled' | 'completed';

export interface City {
  id: string;
  name: string;
}

export interface OffsiteInput {
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  cityId: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
}

export interface Offsite extends OffsiteInput {
  id: string;
  status: OffsiteStatus;
  /** Iscritti arrotondati per difetto alla decina; null sotto la soglia di 10 (D153, D167). */
  attendeesRounded: number | null;
}

// ---------- Errori ----------

export type AdminApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'invalid_totp'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'unavailable';

export class AdminApiError extends Error {
  constructor(
    readonly code: AdminApiErrorCode,
    readonly details: { remainingAttempts?: number; field?: string } = {},
  ) {
    super(code);
    this.name = 'AdminApiError';
  }
}

// ---------- Interfaccia ----------

export interface AdminApi {
  /** POST /backoffice/auth/code: codice all'email dell'operatore; risposta uguale per ogni email. */
  requestSignInCode(email: string): Promise<SignInChallenge>;
  /** POST /backoffice/auth/code/verification: primo fattore. */
  verifySignInCode(challengeId: string, code: string): Promise<SignInChallenge>;
  /** POST /backoffice/auth/totp: secondo fattore, apre la sessione dell'operatore. */
  verifyTotp(challengeId: string, totpCode: string): Promise<OperatorSession>;
  /** GET /backoffice/auth/me: operatore e ruoli letti dal database a ogni richiesta (D231). */
  getCurrentOperator(token: string): Promise<Operator>;
  /** DELETE /backoffice/auth/session */
  signOut(token: string): Promise<void>;

  listCompanies(token: string, search?: string): Promise<Company[]>;
  createCompany(token: string, input: CompanyInput): Promise<Company>;
  getRemovalPreview(token: string, companyId: string): Promise<RemovalPreview>;
  startRemoval(token: string, companyId: string, input: RemovalConfirmation): Promise<Company>;
  cancelRemoval(token: string, companyId: string, input: ApprovalDecision): Promise<Company>;

  getApprovalQueue(token: string): Promise<ApprovalQueue>;
  getApproval(token: string, reviewId: string): Promise<ApprovalDetail>;
  approveProfile(token: string, reviewId: string, input: ApprovalDecision): Promise<void>;
  rejectProfile(token: string, reviewId: string, input: RejectionDecision): Promise<void>;

  listCities(token: string): Promise<City[]>;
  createOffsite(token: string, input: OffsiteInput): Promise<Offsite>;
  publishOffsite(token: string, offsiteId: string): Promise<Offsite>;
}
