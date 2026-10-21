/**
 * Modello del backoffice per le API di amministrazione (`admin-api`, rotte `/backoffice/*`). Le
 * pagine e i gestori lato server usano solo questi tipi e l'interfaccia `AdminApi`; gli
 * adattatori sono `mock` (dati in memoria) e `http` (verso ADMIN_API_URL). I tipi delle richieste
 * e delle risposte HTTP, con le rotte e le conversioni, stanno tutti in `contract.ts`: l'allineamento
 * con `openapi/admin.json` tocca solo quel file.
 *
 * Nessun tipo contiene "chi ti interessa", aziende escluse, blocchi o stato dell'Open space (D90,
 * D175, D197); le email arrivano mascherate e in chiaro solo dalla rivelazione registrata
 * nell'audit. Le date viaggiano come stringhe ISO 8601.
 */
import type { OperatorRole } from '@/lib/roles';

export interface Operator {
  id: string;
  name: string;
  roles: OperatorRole[];
}

export interface OperatorSession {
  /** Token breve emesso da admin-api dopo il codice all'email; non arriva mai al browser (D231). */
  token: string;
  expiresAt: string;
}

/** Motivazione obbligatoria di ogni azione (D91): da 3 a 500 caratteri, senza dati personali. */
export interface Explained {
  explanation: string;
}

/** Conferma rafforzata delle azioni distruttive: nome o identificativo esatto digitato (D93, D244). */
export interface StrongConfirmation extends Explained {
  confirmName: string;
}

/** Pagina di un elenco con cursore (D231): `nextCursor` nullo all'ultima pagina. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------- Aziende (D84, D85, D93, D94, D111, D120, D185) ----------

export type CompanyStatus = 'active' | 'merged' | 'removing';

export interface Company {
  id: string;
  name: string;
  status: CompanyStatus;
  isDemo: boolean;
  domains: string[];
  /** Numero di utenti; null sotto la soglia di 10 persone delle statistiche (D89, D197). */
  usersCount: number | null;
  updatedAt: string;
  /** Fine dell'intervallo di rimozione, solo con status `removing`. */
  removalFinalAt: string | null;
}

export interface CompanyInput extends Explained {
  name: string;
  domains: string[];
  isDemo: boolean;
}

export interface RemovalPreview {
  companyId: string;
  name: string;
  domains: string[];
  accountsCount: number;
}

/**
 * Anteprima di una fusione o di uno spostamento di dominio: la transazione eseguita e annullata,
 * solo conteggi (architettura, "Fusioni di aziende"), più l'avviso di somiglianza dei nomi.
 */
export interface ChangePreview {
  usersMoving: number;
  matchesToRevoke: number;
  likesToDelete: number;
  similarCompanies: string[];
}

/** Fusione (P14): conferma rafforzata con il nome dell'azienda assorbita (D197, D244). */
export interface MergeInput extends StrongConfirmation {
  targetCompanyId: string;
}

/** Spostamento di un dominio (D94): conferma rafforzata con il dominio digitato (D197, D244). */
export interface DomainMoveInput extends StrongConfirmation {
  targetCompanyId: string;
}

// ---------- Richieste di aggiunta e avvisi dell'elenco (D72, D95, P13) ----------

/** Richieste confermate della lista d'attesa raggruppate per dominio, mai legate a utenti. */
export interface WaitlistGroup {
  id: string;
  domain: string;
  requestsCount: number;
  firstAt: string;
  lastAt: string;
}

export type WaitlistOutcome = 'added' | 'not_added';

export interface WaitlistResponse extends Explained {
  outcome: WaitlistOutcome;
}

/** Avviso aggregato di "Lavora nella mia azienda": due aziende, nessuna persona (D72). */
export interface DirectoryAlert {
  id: string;
  reporterCompany: string;
  reportedCompany: string;
  windowStartsAt: string;
  windowEndsAt: string;
  status: 'open' | 'closed';
}

// ---------- Utenti (D89, D90, D91, D93, D197) ----------

export type AccountStatus =
  'registering' | 'pending_approval' | 'active' | 'reverifying' | 'suspended' | 'deleted';

export const SANCTION_TYPES = [
  'warning',
  'disciplinary_suspension',
  'precautionary_suspension',
  'expulsion',
] as const;
export type SanctionType = (typeof SANCTION_TYPES)[number];

/** Motivi delle segnalazioni (D71), codici del glossario. */
export const REPORT_REASONS = [
  'fake_profile',
  'inappropriate_photos',
  'harassment',
  'spam_scam',
  'possible_minor',
  'works_at_my_company',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface UserSummary {
  id: string;
  firstName: string | null;
  status: AccountStatus;
  isDemo: boolean;
  companyName: string | null;
  maskedWorkEmail: string | null;
  createdAt: string;
}

export interface UserReport {
  id: string;
  reason: ReportReason;
  createdAt: string;
  status: 'open' | 'closed';
}

export interface UserSanction {
  id: string;
  type: SanctionType;
  reason: string | null;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  appealStatus: 'none' | 'pending' | 'upheld' | 'rejected';
}

/** Scheda dell'utente (D89): stato, azienda, date, foto e testi, segnalazioni e sanzioni. */
export interface UserDetail extends UserSummary {
  ageYears: number | null;
  maskedPersonalEmail: string | null;
  approvedAt: string | null;
  lastActiveAt: string | null;
  bio: string | null;
  practiceArea: string | null;
  lookingFor: string | null;
  photos: PhotoRef[];
  reports: UserReport[];
  sanctions: UserSanction[];
}

export type EmailKind = 'personal' | 'work';

export interface RevealedEmail {
  kind: EmailKind;
  email: string;
}

export interface SanctionInput extends Explained {
  type: Exclude<SanctionType, 'precautionary_suspension'>;
  /** Testo per l'utente, composto con il modello della sanzione (DSA, art. 17). */
  userExplanation: string;
}

// ---------- Moderazione e ricorsi (D71, D74, D75, D113, D187) ----------

export type ModerationKind = 'report' | 'photo';
export type ReportSeverity = 'severe' | 'standard';

export interface ModerationCaseSummary {
  id: string;
  kind: ModerationKind;
  reason: ReportReason | null;
  severity: ReportSeverity;
  reportsCount: number;
  createdAt: string;
  /** 24 ore per i casi gravi, 72 per gli altri (D74). */
  dueAt: string;
}

/** Messaggio allegato a una segnalazione: il Moderatore legge solo questi (D187). */
export interface FlaggedMessage {
  id: string;
  sentAt: string;
  fromReported: boolean;
  text: string;
}

export interface ModerationCase extends ModerationCaseSummary {
  subject: {
    userId: string;
    firstName: string | null;
    ageYears: number | null;
    status: AccountStatus;
    bio: string | null;
    photos: PhotoRef[];
  };
  reports: { reason: ReportReason; note: string | null; createdAt: string }[];
  flaggedMessages: FlaggedMessage[];
  /** Foto in esame per le code delle foto. */
  photo: PhotoRef | null;
  priorSanctions: number;
}

export const CASE_DECISIONS = [
  'dismiss',
  'remove_content',
  'warning',
  'disciplinary_suspension',
  'expulsion',
] as const;
export type CaseDecision = (typeof CASE_DECISIONS)[number];

export interface CaseDecisionInput extends Explained {
  decision: CaseDecision;
  /** Testo per l'utente sanzionato; non serve per l'archiviazione. */
  userExplanation: string | null;
}

export interface AppealSummary {
  id: string;
  /** Sanzione o blocco dopo il terzo rifiuto dell'approvazione (D142). */
  subject: SanctionType | 'third_rejection';
  submittedAt: string;
  /** Risposta entro 7 giorni (D75). */
  dueAt: string;
}

export interface Appeal extends AppealSummary {
  userId: string | null;
  decisionExplanation: string | null;
  decidedAt: string;
  text: string;
  /** Falso se chi guarda ha deciso la sanzione: il ricorso lo esamina un'altra persona (D197). */
  canDecide: boolean;
}

export interface AppealDecisionInput extends Explained {
  outcome: 'upheld' | 'rejected';
}

// ---------- Approvazioni e foto nuove (D141–D144) ----------

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

export interface PreviousAttempt {
  attempt: number;
  reason: RejectionReason | null;
  userExplanation: string | null;
}

/** Solo ciò che serve alla revisione: mai preferenze, aziende escluse né Open space (D90). */
export interface ApprovalDetail extends ApprovalSummary {
  photos: PhotoRef[];
  companyName: string | null;
  practiceArea: string | null;
  lookingFor: string | null;
  bio: string | null;
  previousAttempts: PreviousAttempt[];
}

export interface ApprovalQueue {
  profiles: ApprovalSummary[];
  profilesCount: number;
  photosCount: number;
}

/** Motivi del rifiuto, uguali all'enum del contratto (RejectDto.reason). */
export const REJECTION_REASONS = [
  'inappropriate_photos',
  'photos_without_person',
  'fake_profile',
  'text_not_allowed',
  'reveals_company_or_clients',
  'other',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface RejectionInput extends Explained {
  reason: RejectionReason;
  /** Cosa correggere: l'utente lo vede solo nell'app (D142). */
  userExplanation: string;
}

export interface RejectionResult {
  attempt: number;
  /** Terzo rifiuto: le due email sono bloccate per 2 anni (D142). */
  blocked: boolean;
}

export interface NewPhoto {
  id: string;
  userId: string;
  firstName: string | null;
  submittedAt: string;
  dueAt: string;
  photo: PhotoRef;
}

export interface NewPhotoDecision extends Explained {
  outcome: 'approved' | 'rejected';
}

// ---------- Offsite (D150, D153, D167, D197) ----------

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
  isDemo: boolean;
  coverUrl: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  /** Iscritti arrotondati per difetto alla decina; null sotto la soglia di 10 (D153, D167). */
  attendeesRounded: number | null;
}

export interface CoverUpload {
  fileName: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}

// ---------- Audit, statistiche e configurazione (D89, D99, D112) ----------

export type AuditType = 'action' | 'security';

/** Riga dell'audit: chi, cosa, quando e perché, con un identificativo interno (D112). */
export interface AuditEntry {
  id: string;
  at: string;
  type: AuditType;
  action: string;
  operatorName: string | null;
  /** Identificativo interno dell'oggetto, mai email, nomi o contenuti. */
  subjectRef: string | null;
  explanation: string | null;
}

export interface AuditFilter {
  type?: AuditType;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface AuditExport {
  fileName: string;
  csv: string;
}

export const STAT_KEYS = [
  'activeUsers',
  'pendingApprovals',
  'registrations7d',
  'matches7d',
  'reports7d',
  'openSpaceActive',
  'companies',
  'offsitesPublished',
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Statistiche solo aggregate: null sotto la soglia di 10 persone (D89, D197). */
export interface Stats {
  generatedAt: string;
  values: Record<StatKey, number | null>;
}

export interface ConfigLimit {
  key: string;
  value: number;
  min: number;
  max: number;
  unit: 'count' | 'hours' | 'days';
}

export interface TaxonomyItem {
  key: string;
  active: boolean;
}

export const TAXONOMIES = ['interests', 'practiceAreas', 'lookingFor', 'profileQuestions'] as const;
export type TaxonomyId = (typeof TAXONOMIES)[number];

export interface Taxonomy {
  id: TaxonomyId;
  items: TaxonomyItem[];
}

export interface SystemConfig {
  limits: ConfigLimit[];
  taxonomies: Taxonomy[];
  citiesCount: number;
}

// ---------- Account dimostrativi e finestre di revisione degli store (D42) ----------

export type Store = 'apple' | 'google';

export interface ReviewWindow {
  id: string;
  store: Store;
  openedAt: string;
  endsAt: string;
  closedAt: string | null;
  failedAttempts: number;
}

export interface DemoAccount {
  id: string;
  firstName: string;
  companyName: string;
  maskedEmail: string;
}

export interface StoreReview {
  windows: ReviewWindow[];
  accounts: DemoAccount[];
}

export interface OpenWindowInput extends Explained {
  store: Store;
  /** Al massimo 14 giorni (D42). */
  days: number;
}

export interface OpenedWindow {
  window: ReviewWindow;
  /** Codice di revisione mostrato una sola volta: admin-api ne conserva solo l'impronta. */
  code: string;
}

// ---------- Errori ----------

export type AdminApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'invalid_credentials'
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
  // Accesso (D88, D231, D244): codice all'email, poi la sua verifica.
  requestSignInCode(email: string): Promise<void>;
  verifySignIn(email: string, code: string): Promise<OperatorSession>;
  getCurrentOperator(token: string): Promise<Operator>;
  signOut(token: string): Promise<void>;

  // Aziende
  listCompanies(token: string, search?: string): Promise<Company[]>;
  getCompany(token: string, companyId: string): Promise<Company>;
  createCompany(token: string, input: CompanyInput): Promise<Company>;
  renameCompany(
    token: string,
    companyId: string,
    input: Explained & { name: string },
  ): Promise<Company>;
  addDomain(
    token: string,
    companyId: string,
    input: Explained & { domain: string },
  ): Promise<Company>;
  removeDomain(
    token: string,
    companyId: string,
    domain: string,
    input: Explained,
  ): Promise<Company>;
  previewMerge(token: string, companyId: string, targetCompanyId: string): Promise<ChangePreview>;
  mergeCompany(token: string, companyId: string, input: MergeInput): Promise<Company>;
  previewDomainMove(token: string, domain: string, targetCompanyId: string): Promise<ChangePreview>;
  moveDomain(token: string, domain: string, input: DomainMoveInput): Promise<Company>;
  getRemovalPreview(token: string, companyId: string): Promise<RemovalPreview>;
  startRemoval(token: string, companyId: string, input: StrongConfirmation): Promise<Company>;
  cancelRemoval(token: string, companyId: string, input: Explained): Promise<Company>;

  // Richieste di aggiunta
  listWaitlist(token: string): Promise<WaitlistGroup[]>;
  respondWaitlist(token: string, groupId: string, input: WaitlistResponse): Promise<void>;
  listDirectoryAlerts(token: string): Promise<DirectoryAlert[]>;

  // Utenti
  searchUsers(token: string, query: { email?: string; id?: string }): Promise<UserSummary[]>;
  getUser(token: string, userId: string): Promise<UserDetail>;
  revealEmail(
    token: string,
    userId: string,
    kind: EmailKind,
    input: Explained,
  ): Promise<RevealedEmail>;
  forceReverification(token: string, userId: string, input: Explained): Promise<void>;
  sanctionUser(token: string, userId: string, input: SanctionInput): Promise<void>;
  reactivateUser(token: string, userId: string, input: Explained): Promise<void>;
  deleteUser(token: string, userId: string, input: StrongConfirmation): Promise<void>;

  // Moderazione e ricorsi
  getModerationQueue(token: string): Promise<ModerationCaseSummary[]>;
  getModerationCase(token: string, caseId: string): Promise<ModerationCase>;
  decideCase(token: string, caseId: string, input: CaseDecisionInput): Promise<void>;
  listAppeals(token: string): Promise<AppealSummary[]>;
  getAppeal(token: string, appealId: string): Promise<Appeal>;
  decideAppeal(token: string, appealId: string, input: AppealDecisionInput): Promise<void>;

  // Approvazioni e foto nuove
  getApprovalQueue(token: string): Promise<ApprovalQueue>;
  getApproval(token: string, reviewId: string): Promise<ApprovalDetail>;
  approveProfile(token: string, reviewId: string, input: Explained): Promise<void>;
  rejectProfile(token: string, reviewId: string, input: RejectionInput): Promise<RejectionResult>;
  getNewPhotos(token: string): Promise<NewPhoto[]>;
  decideNewPhoto(token: string, photoId: string, input: NewPhotoDecision): Promise<void>;

  // Offsite
  listCities(token: string): Promise<City[]>;
  listOffsites(token: string): Promise<Offsite[]>;
  getOffsite(token: string, offsiteId: string): Promise<Offsite>;
  createOffsite(token: string, input: OffsiteInput): Promise<Offsite>;
  updateOffsite(token: string, offsiteId: string, input: OffsiteInput): Promise<Offsite>;
  publishOffsite(token: string, offsiteId: string): Promise<Offsite>;
  cancelOffsite(token: string, offsiteId: string, input: Explained): Promise<Offsite>;
  uploadCover(token: string, offsiteId: string, cover: CoverUpload): Promise<Offsite>;

  // Audit, statistiche, configurazione
  listAudit(token: string, filter: AuditFilter): Promise<Page<AuditEntry>>;
  exportAudit(token: string, filter: AuditFilter): Promise<AuditExport>;
  getStats(token: string): Promise<Stats>;
  getConfig(token: string): Promise<SystemConfig>;
  updateLimit(
    token: string,
    key: string,
    input: Explained & { value: number },
  ): Promise<ConfigLimit>;
  setTaxonomyItem(
    token: string,
    taxonomy: TaxonomyId,
    key: string,
    input: Explained & { active: boolean },
  ): Promise<TaxonomyItem>;

  // Account dimostrativi
  getStoreReview(token: string): Promise<StoreReview>;
  openReviewWindow(token: string, input: OpenWindowInput): Promise<OpenedWindow>;
  closeReviewWindow(token: string, windowId: string, input: Explained): Promise<ReviewWindow>;
  resetDemoData(token: string, windowId: string, input: Explained): Promise<void>;
}
