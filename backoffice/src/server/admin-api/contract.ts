/**
 * Contratto HTTP delle API di amministrazione, in un solo modulo: tipi delle richieste e delle
 * risposte, rotte, codici d'errore e conversioni verso il modello del backoffice (`types.ts`).
 * L'adattatore `http` non conosce altro: l'allineamento finale con `openapi/admin.json` tocca
 * solo questo file.
 *
 * Fonte: il contratto finale di `openapi/admin.json` (branch `feat/integrazione`, unione di B1, B2
 * e B3): rotte, corpi delle richieste e codici d'errore sono quelli dello schema, provati end to
 * end contro admin-api vera (`npm run test:e2e`). Accesso: `POST /backoffice/auth/code`, poi
 * `POST /backoffice/auth/verify` con il solo codice, senza secondo fattore (D244;
 * `invalid_credentials`, `code_expired`, `too_many_attempts`); conferma rafforzata con
 * `confirmName` esatto e la motivazione, anche per fusioni e spostamenti di dominio (D197).
 *
 * Campi facoltativi nei DTO: se lo schema non li restituisce, la conversione usa un valore neutro.
 */
import {
  AdminApiError,
  type AdminApiErrorCode,
  type Appeal,
  type AppealDecisionInput,
  type AppealSummary,
  type ApprovalDetail,
  type ApprovalSummary,
  type AuditEntry,
  type AuditExport,
  type AuditFilter,
  type CaseDecisionInput,
  type ChangePreview,
  type City,
  type Company,
  type CompanyInput,
  type CoverUpload,
  type DemoAccount,
  type DirectoryAlert,
  type DomainMoveInput,
  type EmailKind,
  type Explained,
  type MergeInput,
  type ModerationCase,
  type ModerationCaseSummary,
  type NewPhoto,
  type NewPhotoDecision,
  type Offsite,
  type OffsiteInput,
  type OpenWindowInput,
  type OpenedWindow,
  type Operator,
  type OperatorSession,
  type Page,
  type PhotoPlaceholder,
  type PhotoRef,
  type RejectionInput,
  type RejectionReason,
  type RejectionResult,
  type RemovalPreview,
  type RevealedEmail,
  type ReviewWindow,
  type SanctionInput,
  type Stats,
  type StoreReview,
  type StrongConfirmation,
  type SystemConfig,
  type ConfigLimit,
  type TaxonomyId,
  type TaxonomyItem,
  type UserDetail,
  type UserSummary,
  type WaitlistGroup,
  type WaitlistResponse,
} from './types';

// =====================================================================================
// Tipi del contratto di main (openapi/admin.json)
// =====================================================================================

export interface OperatorEmailDto {
  email: string;
}

export interface OperatorVerifyDto {
  email: string;
  code: string;
}

export interface OperatorSessionDto {
  token: string;
  expiresAt: string;
}

export interface OperatorMeDto {
  id: string;
  name: string;
  roles: ('admin' | 'moderator' | 'support')[];
}

export interface ExplanationDto {
  explanation: string;
}

export interface StrongConfirmationDto extends ExplanationDto {
  confirmName: string;
}

export interface CompanyDto {
  id: string;
  name: string;
  status: 'active' | 'merged' | 'removing';
  isDemo: boolean;
  domains: string[];
  createdAt: string;
  /** [Proposta] numero degli utenti, null sotto la soglia di 10 (D89). */
  usersCount?: number | null;
  /** [Proposta] data dell'ultima modifica. */
  updatedAt?: string;
  /** [Proposta] fine dell'intervallo della rimozione (D111). */
  removalFinalAt?: string | null;
}

export interface CreateCompanyDto extends ExplanationDto {
  name: string;
  domains: string[];
  isDemo?: boolean;
}

export interface RenameCompanyDto extends ExplanationDto {
  name: string;
}

export interface AddDomainDto extends ExplanationDto {
  domain: string;
}

export interface QueueItemDto {
  reviewId: string;
  userId: string;
  attempt: number;
  submittedAt: string;
  dueAt: string;
  minutesLeft: number;
  firstName: string | null;
  ageYears: number;
  gender: string | null;
  practiceArea: string | null;
  lookingFor: string | null;
  bio: string | null;
  companyName: string | null;
  /** [Proposta] URL firmato della prima foto per la coda. */
  photoUrl?: string | null;
}

export interface ReviewPhotoDto {
  id: string;
  position: number;
  status: string;
  /** [Proposta] URL firmato di breve durata (adattatore delle foto del backend). */
  url?: string | null;
}

export interface PreviousAttemptDto {
  attempt: number;
  reason: string | null;
  explanation: string | null;
}

export interface ReviewDetailDto extends Omit<QueueItemDto, 'photoUrl'> {
  outcome: 'pending' | 'approved' | 'rejected';
  photos: ReviewPhotoDto[];
  previousAttempts: PreviousAttemptDto[];
}

export interface RejectDto extends ExplanationDto {
  reason: RejectionReason;
  userExplanation: string;
}

export interface RejectResultDto {
  attempt: number;
  blocked: boolean;
}

export interface CreateOffsiteDto extends ExplanationDto {
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  cityId: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  isDemo?: boolean;
}

export type UpdateOffsiteDto = ExplanationDto & Partial<Omit<CreateOffsiteDto, 'isDemo'>>;

export interface OffsiteDto {
  id: string;
  title: string;
  description: string;
  coverKey: string | null;
  venueName: string;
  venueAddress: string;
  cityId: string;
  startsAt: string;
  endsAt: string;
  capacity: number | null;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  isDemo: boolean;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
  cancelledAt: string | null;
  /** 0 = "meno di 10", poi la decina per difetto (D167). */
  attendeesRounded: number;
  /** [Proposta] URL firmato della copertina. */
  coverUrl?: string | null;
}

// =====================================================================================
// [Proposta] Tipi delle rotte dell'architettura non ancora nel contratto
// =====================================================================================

export interface CityDto {
  id: string;
  name: string;
}

export interface RemovalPreviewDto {
  name: string;
  accountsCount: number;
  domains: string[];
}

export interface ChangePreviewDto {
  usersMoving: number;
  matchesToRevoke: number;
  likesToDelete: number;
  similarCompanies: string[];
}

export interface TargetDto extends StrongConfirmationDto {
  targetCompanyId: string;
}

export interface WaitlistGroupDto {
  id: string;
  domain: string;
  requestsCount: number;
  firstAt: string;
  lastAt: string;
}

export interface WaitlistResponseDto extends ExplanationDto {
  outcome: 'added' | 'not_added';
}

export interface DirectoryAlertDto {
  id: string;
  reporterCompany: string;
  reportedCompany: string;
  windowStartsAt: string;
  windowEndsAt: string;
  status: 'open' | 'closed';
}

export type UserSummaryDto = UserSummary;
export type UserDetailDto = Omit<UserDetail, 'photos'> & { photos: ReviewPhotoDto[] };

export interface RevealEmailDto extends ExplanationDto {
  kind: EmailKind;
}

export interface RevealedEmailDto {
  kind: EmailKind;
  email: string;
}

export interface SanctionDto extends ExplanationDto {
  type: SanctionInput['type'];
  userExplanation: string;
}

export type ModerationCaseSummaryDto = ModerationCaseSummary;

export interface ModerationCaseDto extends Omit<ModerationCase, 'subject' | 'photo'> {
  subject: Omit<ModerationCase['subject'], 'photos'> & { photos: ReviewPhotoDto[] };
  photo: ReviewPhotoDto | null;
}

export interface CaseDecisionDto extends ExplanationDto {
  decision: CaseDecisionInput['decision'];
  userExplanation?: string;
}

export type AppealSummaryDto = AppealSummary;
export type AppealDto = Appeal;

export interface AppealDecisionDto extends ExplanationDto {
  outcome: AppealDecisionInput['outcome'];
}

export interface NewPhotoDto {
  id: string;
  userId: string;
  firstName: string | null;
  submittedAt: string;
  dueAt: string;
  photo: ReviewPhotoDto;
}

export interface NewPhotoOutcomeDto extends ExplanationDto {
  outcome: NewPhotoDecision['outcome'];
}

export type AuditEntryDto = AuditEntry;
export type StatsDto = Stats;
export type SystemConfigDto = SystemConfig;

export interface LimitUpdateDto extends ExplanationDto {
  value: number;
}

export interface TaxonomyItemUpdateDto extends ExplanationDto {
  active: boolean;
}

export type ReviewWindowDto = ReviewWindow;

export interface StoreReviewDto {
  windows: ReviewWindowDto[];
  accounts: DemoAccount[];
}

export interface OpenWindowDto extends ExplanationDto {
  store: OpenWindowInput['store'];
  days: number;
}

export interface OpenedWindowDto {
  window: ReviewWindowDto;
  code: string;
}

// =====================================================================================
// Descrizione delle chiamate
// =====================================================================================

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Codice del backoffice per un codice d'errore di admin-api, con il campo interessato. */
type ErrorTarget = AdminApiErrorCode | readonly [AdminApiErrorCode, string];

export interface Call<T> {
  method: HttpMethod;
  path: string;
  /** Corpo JSON. */
  body?: unknown;
  /** Corpo multipart (copertina). */
  form?: FormData;
  /** Senza token dell'operatore: solo le rotte pubbliche dell'accesso. */
  anonymous?: boolean;
  /** `text` per l'esportazione dell'audit in CSV. */
  accept?: 'json' | 'text';
  /** Traduzioni dei codici d'errore proprie della rotta, prima di quelle comuni. */
  errors?: Readonly<Record<string, ErrorTarget>>;
  read: (payload: unknown, headers: Headers) => T;
}

/** Codici d'errore comuni di admin-api (src/infra/http/api-error.ts e servizi di dominio). */
const COMMON_ERRORS: Readonly<Record<string, ErrorTarget>> = {
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  validation: 'validation',
  rate_limited: 'too_many_attempts',
  invalid_credentials: 'invalid_credentials',
  code_expired: 'code_expired',
  too_many_attempts: 'too_many_attempts',
  'code.invalid': 'invalid_code',
  'code.expired': 'code_expired',
  'confirmation.mismatch': ['validation', 'confirmName'],
  'company.duplicate': ['conflict', 'name'],
  'company.domain.inUse': ['conflict', 'domains'],
  'company.domain.invalid': ['validation', 'domains'],
  'company.domain.notAllowed': ['validation', 'domains'],
  'company.hasUsers': 'conflict',
  'approval.alreadyDecided': 'conflict',
  'approval.attempts.exhausted': 'conflict',
  'approval.explanation.required': ['validation', 'explanation'],
  'offsite.dates.invalid': ['validation', 'endsAt'],
  'offsite.notDraft': 'conflict',
  'offsite.notEditable': 'conflict',
  'offsite.typeImmutable': 'conflict',
};

const STATUS_ERRORS: Readonly<Record<number, AdminApiErrorCode>> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'validation',
  415: 'validation',
  422: 'validation',
  429: 'too_many_attempts',
};

/** Traduce il corpo `{ error: { code, fields } }` nel codice del backoffice. */
export function toAdminApiError(
  status: number,
  payload: unknown,
  routeErrors: Readonly<Record<string, ErrorTarget>> = {},
): AdminApiError {
  const error = (
    payload as {
      error?: { code?: unknown; fields?: unknown; remainingAttempts?: unknown };
    } | null
  )?.error;
  const code = typeof error?.code === 'string' ? error.code : null;
  const target = code ? (routeErrors[code] ?? COMMON_ERRORS[code]) : undefined;
  // Tentativi rimasti dell'accesso (`invalid_credentials`, `too_many_attempts`)
  const attempts =
    typeof error?.remainingAttempts === 'number'
      ? { remainingAttempts: error.remainingAttempts }
      : {};
  if (target) {
    const [mapped, field] = typeof target === 'string' ? [target, undefined] : target;
    return new AdminApiError(mapped, {
      ...attempts,
      ...(field ? { field } : validationField(error?.fields)),
    });
  }
  return new AdminApiError(STATUS_ERRORS[status] ?? 'unavailable', validationField(error?.fields));
}

/** Primo campo citato dagli errori di class-validator ("explanation must be longer…"). */
function validationField(fields: unknown): { field?: string } {
  if (!Array.isArray(fields) || typeof fields[0] !== 'string') return {};
  const field = /^([A-Za-z]+)/.exec(fields[0])?.[1];
  return field ? { field } : {};
}

const seg = (value: string) => encodeURIComponent(value);

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const PLACEHOLDERS: readonly PhotoPlaceholder[] = ['terracotta', 'sage', 'sand'];

function photoRef(dto: ReviewPhotoDto, index = dto.position): PhotoRef {
  return {
    id: dto.id,
    url: dto.url ?? null,
    placeholder: PLACEHOLDERS[Math.abs(index) % PLACEHOLDERS.length]!,
  };
}

function company(dto: CompanyDto): Company {
  return {
    id: dto.id,
    name: dto.name,
    status: dto.status,
    isDemo: dto.isDemo,
    domains: dto.domains,
    usersCount: dto.usersCount ?? null,
    updatedAt: dto.updatedAt ?? dto.createdAt,
    removalFinalAt: dto.removalFinalAt ?? null,
  };
}

function approvalSummary(dto: QueueItemDto): ApprovalSummary {
  return {
    id: dto.reviewId,
    name: dto.firstName ?? '',
    age: dto.ageYears,
    attempt: dto.attempt,
    maxAttempts: 3,
    submittedAt: dto.submittedAt,
    dueAt: dto.dueAt,
    photo: dto.photoUrl
      ? { id: `${dto.reviewId}-cover`, url: dto.photoUrl, placeholder: 'sand' }
      : null,
  };
}

function approvalDetail(dto: ReviewDetailDto): ApprovalDetail {
  const photos = [...dto.photos].sort((a, b) => a.position - b.position).map((p) => photoRef(p));
  return {
    ...approvalSummary(dto),
    photo: photos[0] ?? null,
    photos,
    companyName: dto.companyName,
    practiceArea: dto.practiceArea,
    lookingFor: dto.lookingFor,
    bio: dto.bio,
    previousAttempts: dto.previousAttempts.map((item) => ({
      attempt: item.attempt,
      reason: (item.reason as RejectionReason | null) ?? null,
      userExplanation: item.explanation,
    })),
  };
}

function offsite(dto: OffsiteDto): Offsite {
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description,
    venueName: dto.venueName,
    venueAddress: dto.venueAddress,
    cityId: dto.cityId,
    startsAt: dto.startsAt,
    endsAt: dto.endsAt,
    capacity: dto.capacity,
    status: dto.status,
    isDemo: dto.isDemo,
    coverUrl: dto.coverUrl ?? null,
    publishedAt: dto.publishedAt,
    cancelledAt: dto.cancelledAt,
    updatedAt: dto.updatedAt,
    attendeesRounded: dto.attendeesRounded > 0 ? dto.attendeesRounded : null,
  };
}

/**
 * Il modulo degli offsite non chiede la motivazione (D238), il contratto sì: si invia un
 * marcatore tecnico, non visibile. [Proposta] da allineare con B3: `explanation` facoltativa
 * nelle rotte degli offsite tranne l'annullamento.
 */
export const OFFSITE_FORM_EXPLANATION = 'backoffice offsite form';

const LIST_LIMIT = 100;
const AUDIT_PAGE = 50;

const json =
  <T>() =>
  (payload: unknown) =>
    payload as T;
const none = () => undefined;

/** Rotte delle API di amministrazione, una per operazione dell'interfaccia `AdminApi`. */
export const routes = {
  // ---------- Accesso (contratto) ----------
  requestSignInCode: (email: string): Call<void> => ({
    method: 'POST',
    path: '/backoffice/auth/code',
    anonymous: true,
    body: { email } satisfies OperatorEmailDto,
    read: none,
  }),
  verifySignIn: (email: string, code: string): Call<OperatorSession> => ({
    method: 'POST',
    path: '/backoffice/auth/verify',
    anonymous: true,
    body: { email, code } satisfies OperatorVerifyDto,
    // Codice sbagliato o indirizzo che non è di un operatore: stessa risposta
    // (`invalid_credentials`, D244).
    errors: { unauthorized: 'invalid_credentials' },
    read: (payload) => {
      const dto = payload as OperatorSessionDto;
      return { token: dto.token, expiresAt: dto.expiresAt };
    },
  }),
  getCurrentOperator: (): Call<Operator> => ({
    method: 'GET',
    path: '/backoffice/auth/me',
    read: (payload) => {
      const dto = payload as OperatorMeDto;
      return { id: dto.id, name: dto.name, roles: dto.roles };
    },
  }),
  signOut: (): Call<void> => ({ method: 'POST', path: '/backoffice/auth/logout', read: none }),

  // ---------- Aziende (contratto, tranne anteprime, fusioni, spostamenti e rimozione) ----------
  listCompanies: (search?: string): Call<Company[]> => ({
    method: 'GET',
    path: `/backoffice/companies${query({ search: search?.slice(0, 60), limit: LIST_LIMIT })}`,
    read: (payload) => (payload as CompanyDto[]).map(company),
  }),
  getCompany: (id: string): Call<Company> => ({
    method: 'GET',
    path: `/backoffice/companies/${seg(id)}`,
    read: (payload) => company(payload as CompanyDto),
  }),
  createCompany: (input: CompanyInput): Call<Company> => ({
    method: 'POST',
    path: '/backoffice/companies',
    body: {
      name: input.name,
      domains: input.domains,
      isDemo: input.isDemo,
      explanation: input.explanation,
    } satisfies CreateCompanyDto,
    read: (payload) => company(payload as CompanyDto),
  }),
  renameCompany: (id: string, input: Explained & { name: string }): Call<Company> => ({
    method: 'PATCH',
    path: `/backoffice/companies/${seg(id)}`,
    body: { name: input.name, explanation: input.explanation } satisfies RenameCompanyDto,
    read: (payload) => company(payload as CompanyDto),
  }),
  addDomain: (id: string, input: Explained & { domain: string }): Call<Company> => ({
    method: 'POST',
    path: `/backoffice/companies/${seg(id)}/domains`,
    body: { domain: input.domain, explanation: input.explanation } satisfies AddDomainDto,
    errors: { validation: ['validation', 'domain'] },
    read: (payload) => company(payload as CompanyDto),
  }),
  removeDomain: (id: string, domain: string, input: Explained): Call<Company> => ({
    method: 'DELETE',
    path: `/backoffice/companies/${seg(id)}/domains/${seg(domain)}`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: (payload) => company(payload as CompanyDto),
  }),
  previewMerge: (id: string, targetCompanyId: string): Call<ChangePreview> => ({
    method: 'GET',
    path: `/backoffice/companies/${seg(id)}/merge/preview${query({ into: targetCompanyId })}`,
    read: json<ChangePreviewDto>(),
  }),
  mergeCompany: (id: string, input: MergeInput): Call<Company> => ({
    method: 'POST',
    path: `/backoffice/companies/${seg(id)}/merge`,
    body: { targetCompanyId: input.targetCompanyId, ...strong(input) } satisfies TargetDto,
    read: (payload) => company(payload as CompanyDto),
  }),
  previewDomainMove: (domain: string, targetCompanyId: string): Call<ChangePreview> => ({
    method: 'GET',
    path: `/backoffice/domains/${seg(domain)}/move/preview${query({ to: targetCompanyId })}`,
    read: json<ChangePreviewDto>(),
  }),
  moveDomain: (domain: string, input: DomainMoveInput): Call<Company> => ({
    method: 'POST',
    path: `/backoffice/domains/${seg(domain)}/move`,
    body: { targetCompanyId: input.targetCompanyId, ...strong(input) } satisfies TargetDto,
    read: (payload) => company(payload as CompanyDto),
  }),
  getRemovalPreview: (id: string): Call<RemovalPreview> => ({
    method: 'GET',
    path: `/backoffice/companies/${seg(id)}/removal/preview`,
    read: (payload) => {
      const dto = payload as RemovalPreviewDto;
      return {
        companyId: id,
        name: dto.name,
        domains: dto.domains,
        accountsCount: dto.accountsCount,
      };
    },
  }),
  startRemoval: (id: string, input: StrongConfirmation): Call<Company> => ({
    method: 'POST',
    path: `/backoffice/companies/${seg(id)}/removal`,
    body: strong(input),
    read: (payload) => company(payload as CompanyDto),
  }),
  cancelRemoval: (id: string, input: Explained): Call<Company> => ({
    method: 'DELETE',
    path: `/backoffice/companies/${seg(id)}/removal`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: (payload) => company(payload as CompanyDto),
  }),

  // ---------- Richieste di aggiunta e avvisi aggregati [Proposta] ----------
  listWaitlist: (): Call<WaitlistGroup[]> => ({
    method: 'GET',
    path: '/backoffice/waitlist',
    read: json<WaitlistGroupDto[]>(),
  }),
  respondWaitlist: (id: string, input: WaitlistResponse): Call<void> => ({
    method: 'POST',
    path: `/backoffice/waitlist/${seg(id)}/response`,
    body: {
      outcome: input.outcome,
      explanation: input.explanation,
    } satisfies WaitlistResponseDto,
    read: none,
  }),
  listDirectoryAlerts: (): Call<DirectoryAlert[]> => ({
    method: 'GET',
    path: '/backoffice/directory-alerts',
    read: json<DirectoryAlertDto[]>(),
  }),

  // ---------- Utenti [Proposta] ----------
  searchUsers: (search: { email?: string; id?: string }): Call<UserSummary[]> => ({
    method: 'GET',
    path: `/backoffice/users${query({ email: search.email, id: search.id })}`,
    read: json<UserSummaryDto[]>(),
  }),
  getUser: (id: string): Call<UserDetail> => ({
    method: 'GET',
    path: `/backoffice/users/${seg(id)}`,
    read: (payload) => {
      const dto = payload as UserDetailDto;
      return { ...dto, photos: dto.photos.map((p) => photoRef(p)) };
    },
  }),
  revealEmail: (id: string, kind: EmailKind, input: Explained): Call<RevealedEmail> => ({
    method: 'POST',
    path: `/backoffice/users/${seg(id)}/reveal-email`,
    body: { kind, explanation: input.explanation } satisfies RevealEmailDto,
    read: json<RevealedEmailDto>(),
  }),
  forceReverification: (id: string, input: Explained): Call<void> => ({
    method: 'POST',
    path: `/backoffice/users/${seg(id)}/reverification`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: none,
  }),
  sanctionUser: (id: string, input: SanctionInput): Call<void> => ({
    method: 'POST',
    path: `/backoffice/users/${seg(id)}/sanctions`,
    body: {
      type: input.type,
      explanation: input.explanation,
      userExplanation: input.userExplanation,
    } satisfies SanctionDto,
    read: none,
  }),
  reactivateUser: (id: string, input: Explained): Call<void> => ({
    method: 'POST',
    path: `/backoffice/users/${seg(id)}/reactivation`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: none,
  }),
  deleteUser: (id: string, input: StrongConfirmation): Call<void> => ({
    method: 'DELETE',
    path: `/backoffice/users/${seg(id)}`,
    body: strong(input),
    read: none,
  }),

  // ---------- Moderazione e ricorsi [Proposta] ----------
  getModerationQueue: (): Call<ModerationCaseSummary[]> => ({
    method: 'GET',
    path: '/backoffice/moderation/queue',
    read: json<ModerationCaseSummaryDto[]>(),
  }),
  getModerationCase: (id: string): Call<ModerationCase> => ({
    method: 'GET',
    path: `/backoffice/moderation/cases/${seg(id)}`,
    read: (payload) => {
      const dto = payload as ModerationCaseDto;
      return {
        ...dto,
        subject: { ...dto.subject, photos: dto.subject.photos.map((p) => photoRef(p)) },
        photo: dto.photo ? photoRef(dto.photo) : null,
      };
    },
  }),
  decideCase: (id: string, input: CaseDecisionInput): Call<void> => ({
    method: 'POST',
    path: `/backoffice/moderation/cases/${seg(id)}`,
    body: {
      decision: input.decision,
      explanation: input.explanation,
      ...(input.userExplanation ? { userExplanation: input.userExplanation } : {}),
    } satisfies CaseDecisionDto,
    read: none,
  }),
  listAppeals: (): Call<AppealSummary[]> => ({
    method: 'GET',
    path: '/backoffice/appeals',
    read: json<AppealSummaryDto[]>(),
  }),
  getAppeal: (id: string): Call<Appeal> => ({
    method: 'GET',
    path: `/backoffice/appeals/${seg(id)}`,
    read: json<AppealDto>(),
  }),
  decideAppeal: (id: string, input: AppealDecisionInput): Call<void> => ({
    method: 'POST',
    path: `/backoffice/appeals/${seg(id)}/decision`,
    body: { outcome: input.outcome, explanation: input.explanation } satisfies AppealDecisionDto,
    read: none,
  }),

  // ---------- Approvazioni (contratto) e foto nuove [Proposta] ----------
  getApprovalQueue: (): Call<ApprovalSummary[]> => ({
    method: 'GET',
    path: `/backoffice/approvals/queue${query({ limit: LIST_LIMIT })}`,
    read: (payload) => (payload as QueueItemDto[]).map(approvalSummary),
  }),
  getApproval: (id: string): Call<ApprovalDetail> => ({
    method: 'GET',
    path: `/backoffice/approvals/${seg(id)}`,
    read: (payload) => approvalDetail(payload as ReviewDetailDto),
  }),
  approveProfile: (id: string, input: Explained): Call<void> => ({
    method: 'POST',
    path: `/backoffice/approvals/${seg(id)}/approval`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: none,
  }),
  rejectProfile: (id: string, input: RejectionInput): Call<RejectionResult> => ({
    method: 'POST',
    path: `/backoffice/approvals/${seg(id)}/rejection`,
    body: {
      reason: input.reason,
      explanation: input.explanation,
      userExplanation: input.userExplanation,
    } satisfies RejectDto,
    read: json<RejectResultDto>(),
  }),
  getNewPhotos: (): Call<NewPhoto[]> => ({
    method: 'GET',
    path: `/backoffice/new-photos/queue${query({ limit: LIST_LIMIT })}`,
    read: (payload) =>
      (payload as NewPhotoDto[]).map((dto) => ({ ...dto, photo: photoRef(dto.photo) })),
  }),
  decideNewPhoto: (id: string, input: NewPhotoDecision): Call<void> => ({
    method: 'POST',
    path: `/backoffice/new-photos/${seg(id)}/outcome`,
    body: { outcome: input.outcome, explanation: input.explanation } satisfies NewPhotoOutcomeDto,
    read: none,
  }),

  // ---------- Offsite (contratto, tranne città e copertina) ----------
  listCities: (): Call<City[]> => ({
    method: 'GET',
    path: '/backoffice/config/cities',
    read: json<CityDto[]>(),
  }),
  listOffsites: (): Call<Offsite[]> => ({
    method: 'GET',
    path: `/backoffice/offsites${query({ limit: LIST_LIMIT })}`,
    read: (payload) => (payload as OffsiteDto[]).map(offsite),
  }),
  getOffsite: (id: string): Call<Offsite> => ({
    method: 'GET',
    path: `/backoffice/offsites/${seg(id)}`,
    read: (payload) => offsite(payload as OffsiteDto),
  }),
  createOffsite: (input: OffsiteInput): Call<Offsite> => ({
    method: 'POST',
    path: '/backoffice/offsites',
    body: { ...input, explanation: OFFSITE_FORM_EXPLANATION } satisfies CreateOffsiteDto,
    read: (payload) => offsite(payload as OffsiteDto),
  }),
  updateOffsite: (id: string, input: OffsiteInput): Call<Offsite> => ({
    method: 'PATCH',
    path: `/backoffice/offsites/${seg(id)}`,
    body: { ...input, explanation: OFFSITE_FORM_EXPLANATION } satisfies UpdateOffsiteDto,
    read: (payload) => offsite(payload as OffsiteDto),
  }),
  publishOffsite: (id: string): Call<Offsite> => ({
    method: 'POST',
    path: `/backoffice/offsites/${seg(id)}/publication`,
    body: { explanation: OFFSITE_FORM_EXPLANATION } satisfies ExplanationDto,
    read: (payload) => offsite(payload as OffsiteDto),
  }),
  cancelOffsite: (id: string, input: Explained): Call<Offsite> => ({
    method: 'POST',
    path: `/backoffice/offsites/${seg(id)}/cancellation`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: (payload) => offsite(payload as OffsiteDto),
  }),
  uploadCover: (id: string, cover: CoverUpload): Call<Offsite> => {
    const form = new FormData();
    form.set(
      'file',
      new Blob([cover.bytes as Uint8Array<ArrayBuffer>], { type: cover.contentType }),
      cover.fileName,
    );
    return {
      method: 'POST',
      path: `/backoffice/offsites/${seg(id)}/cover`,
      form,
      errors: { validation: ['validation', 'cover'] },
      read: (payload) => offsite(payload as OffsiteDto),
    };
  },

  // ---------- Audit, statistiche e configurazione [Proposta] ----------
  listAudit: (filter: AuditFilter): Call<Page<AuditEntry>> => ({
    method: 'GET',
    path: `/backoffice/audit${auditQuery(filter, { before: filter.cursor, limit: AUDIT_PAGE })}`,
    read: (payload) => {
      const items = payload as AuditEntryDto[];
      return {
        items,
        nextCursor: items.length === AUDIT_PAGE ? (items[items.length - 1]?.id ?? null) : null,
      };
    },
  }),
  exportAudit: (filter: AuditFilter): Call<AuditExport> => ({
    method: 'GET',
    path: `/backoffice/audit/export${auditQuery(filter, { format: 'csv' })}`,
    accept: 'text',
    read: (payload, headers) => ({
      fileName:
        /filename="?([\w.-]+)"?/.exec(headers.get('content-disposition') ?? '')?.[1] ?? 'audit.csv',
      csv: String(payload ?? ''),
    }),
  }),
  getStats: (): Call<Stats> => ({
    method: 'GET',
    path: '/backoffice/stats',
    read: json<StatsDto>(),
  }),
  getConfig: (): Call<SystemConfig> => ({
    method: 'GET',
    path: '/backoffice/config',
    read: json<SystemConfigDto>(),
  }),
  updateLimit: (key: string, input: Explained & { value: number }): Call<ConfigLimit> => ({
    method: 'PUT',
    path: `/backoffice/config/limits/${seg(key)}`,
    body: { value: input.value, explanation: input.explanation } satisfies LimitUpdateDto,
    errors: { validation: ['validation', 'value'] },
    read: json<ConfigLimit>(),
  }),
  setTaxonomyItem: (
    taxonomy: TaxonomyId,
    key: string,
    input: Explained & { active: boolean },
  ): Call<TaxonomyItem> => ({
    method: 'PUT',
    path: `/backoffice/config/taxonomies/${seg(taxonomy)}/${seg(key)}`,
    body: { active: input.active, explanation: input.explanation } satisfies TaxonomyItemUpdateDto,
    read: json<TaxonomyItem>(),
  }),

  // ---------- Account dimostrativi e finestre di revisione [Proposta] ----------
  getStoreReview: (): Call<StoreReview> => ({
    method: 'GET',
    path: '/backoffice/store-review',
    read: json<StoreReviewDto>(),
  }),
  openReviewWindow: (input: OpenWindowInput): Call<OpenedWindow> => ({
    method: 'POST',
    path: '/backoffice/store-review/windows',
    body: {
      store: input.store,
      days: input.days,
      explanation: input.explanation,
    } satisfies OpenWindowDto,
    errors: { validation: ['validation', 'days'] },
    read: json<OpenedWindowDto>(),
  }),
  closeReviewWindow: (id: string, input: Explained): Call<ReviewWindow> => ({
    method: 'POST',
    path: `/backoffice/store-review/windows/${seg(id)}/close`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: json<ReviewWindowDto>(),
  }),
  resetDemoData: (id: string, input: Explained): Call<void> => ({
    method: 'POST',
    path: `/backoffice/store-review/windows/${seg(id)}/reset`,
    body: { explanation: input.explanation } satisfies ExplanationDto,
    read: none,
  }),
} as const;

function strong(input: StrongConfirmation): StrongConfirmationDto {
  return { explanation: input.explanation, confirmName: input.confirmName };
}

function auditQuery(filter: AuditFilter, extra: Record<string, string | number | undefined>) {
  return query({
    type: filter.type,
    action: filter.action,
    from: filter.from,
    to: filter.to,
    ...extra,
  });
}
