// Schema Drizzle delle tabelle usate dal codice applicativo. La fonte del modello è nelle
// migrazioni SQL (`db/migrations/`), con funzioni, trigger e ruoli: questo file ne riporta le
// colonne per avere query tipizzate e deve restare allineato (lo verifica la suite RC, che usa
// entrambe).
import {
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const accountStatus = pgEnum('account_status', [
  'registering',
  'pending_approval',
  'active',
  'reverifying',
  'suspended',
  'deleted',
]);
export const companyStatus = pgEnum('company_status', ['active', 'merged', 'removing']);
export const workEmailStatus = pgEnum('work_email_status', ['active', 'historical']);
export const consentType = pgEnum('consent_type', ['art9', 'terms', 'p7_declaration']);
export const identityProvider = pgEnum('identity_provider', ['apple', 'google', 'email']);
export const signInMethod = pgEnum('sign_in_method', [
  'apple',
  'google',
  'personal_email',
  'work_email',
  'review_code',
]);
export const sessionScope = pgEnum('session_scope', [
  'full',
  'registration',
  'approval',
  'restore',
  'limited',
]);
export const openSpaceSource = pgEnum('open_space_source', [
  'registration',
  'approval',
  'user',
  'company_change',
]);
export const exclusionSource = pgEnum('exclusion_source', [
  'registration',
  'approval',
  'user',
  'company_change',
]);
export const genderEnum = pgEnum('gender', ['woman', 'man', 'non_binary', 'undisclosed']);
export const interestedInEnum = pgEnum('interested_in', ['men', 'women', 'everyone']);
export const maxDistanceEnum = pgEnum('max_distance', [
  'city',
  'km25',
  'km50',
  'km100',
  'km200',
  'italy',
]);
export const photoStatus = pgEnum('photo_status', [
  'uploading',
  'checking',
  'pending_approval',
  'approved',
  'under_review',
  'rejected',
]);
export const offsiteStatus = pgEnum('offsite_status', [
  'draft',
  'published',
  'cancelled',
  'completed',
]);
export const reviewOutcome = pgEnum('review_outcome', ['pending', 'approved', 'rejected']);
export const hashType = pgEnum('hash_type', ['personal', 'work']);
export const blockedHashSource = pgEnum('blocked_hash_source', ['expulsion', 'third_rejection']);
export const operatorRole = pgEnum('operator_role', ['admin', 'moderator', 'support']);
export const auditType = pgEnum('audit_type', ['action', 'security']);
export const auditAction = pgEnum('audit_action', [
  'company_created',
  'company_updated',
  'domain_added',
  'domain_moved',
  'domain_removed',
  'companies_merged',
  'removal_started',
  'removal_cancelled',
  'company_deleted',
  'email_revealed',
  'sanction_decided',
  'appeal_decided',
  'reverification_forced',
  'birth_date_corrected',
  'age_verification_recorded',
  'profile_approved',
  'profile_rejected',
  'photo_approved',
  'photo_rejected',
  'third_rejection_block',
  'chat_read',
  'offsite_created',
  'offsite_published',
  'offsite_updated',
  'offsite_cancelled',
  'account_deleted',
  'config_changed',
  'review_window_opened',
  'operator_login',
  'core_rule_trigger',
  'consistency_anomaly',
  'operator_login_failed',
  'review_code_wrong',
  'provider_token_rejected',
  'refresh_token_reused',
]);
export const otpPurpose = pgEnum('otp_purpose', [
  'login',
  'registration',
  'company_change',
  'reverification',
  'personal_email',
  'deletion',
  'waitlist',
  'operator',
]);

export const operators = pgTable('operators', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  roles: operatorRole('roles').array().notNull(),
  encryptedTotpSecret: text('encrypted_totp_secret').notNull(),
  status: text('status').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const operatorSessions = pgTable('operator_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  operatorId: uuid('operator_id').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
  expiresAt: tz('expires_at').notNull(),
  lastTotpAt: tz('last_totp_at').notNull(),
  revokedAt: tz('revoked_at'),
});

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: companyStatus('status').notNull().default('active'),
  mergedIntoCompanyId: uuid('merged_into_company_id'),
  removalStartedAt: tz('removal_started_at'),
  removalFinalAt: tz('removal_final_at'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdBy: uuid('created_by'),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const companyDomains = pgTable('company_domains', {
  domain: text('domain').primaryKey(),
  companyId: uuid('company_id').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const cities = pgTable('cities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provinceCode: text('province_code').notNull(),
  region: text('region').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  population: integer('population').notNull(),
  displayCityId: text('display_city_id'),
  searchName: text('search_name').notNull(),
  isActive: boolean('is_active').notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id'),
  isDemo: boolean('is_demo').notNull().default(false),
  status: accountStatus('status').notNull().default('registering'),
  openSpace: boolean('open_space').notNull().default(false),
  openSpaceSince: tz('open_space_since'),
  openSpacePromptAt: tz('open_space_prompt_at'),
  reverificationDueAt: tz('reverification_due_at'),
  deletionScheduledAt: tz('deletion_scheduled_at'),
  deletionRequestedAt: tz('deletion_requested_at'),
  excludedCompaniesNoticeAt: tz('excluded_companies_notice_at'),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const personalIdentities = pgTable('personal_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  provider: identityProvider('provider').notNull(),
  subject: text('subject').notNull(),
  email: text('email').notNull(),
  emailHash: text('email_hash').notNull(),
  emailVerifiedAt: tz('email_verified_at').notNull(),
  isPrivateRelay: boolean('is_private_relay').notNull().default(false),
  refreshTokenCiphertext: text('refresh_token_ciphertext'),
  refreshTokenKeyVersion: text('refresh_token_key_version'),
  createdAt: tz('created_at').notNull().defaultNow(),
  lastSignInAt: tz('last_sign_in_at'),
  revokedAt: tz('revoked_at'),
});

export const workEmails = pgTable('work_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  companyId: uuid('company_id'),
  domain: text('domain'),
  email: text('email'),
  emailHash: text('email_hash').notNull(),
  status: workEmailStatus('status').notNull().default('active'),
  verifiedAt: tz('verified_at').notNull(),
  nextReverificationAt: tz('next_reverification_at').notNull(),
});

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  type: consentType('type').notNull(),
  textVersion: text('text_version').notNull(),
  givenAt: tz('given_at').notNull().defaultNow(),
  revokedAt: tz('revoked_at'),
});

export const openSpaceHistory = pgTable('open_space_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  enabled: boolean('enabled').notNull(),
  changedAt: tz('changed_at').notNull(),
  source: openSpaceSource('source').notNull(),
  textVersion: text('text_version'),
});

export const excludedCompanies = pgTable(
  'excluded_companies',
  {
    userId: uuid('user_id').notNull(),
    companyId: uuid('company_id').notNull(),
    effectiveAt: tz('effective_at').notNull().defaultNow(),
    source: exclusionSource('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companyId] })],
);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  birthDate: date('birth_date', { mode: 'string' }).notNull(),
  gender: genderEnum('gender'),
  interestedIn: interestedInEnum('interested_in'),
  lookingFor: text('looking_for'),
  bio: text('bio'),
  practiceArea: text('practice_area'),
  homeCityId: text('home_city_id'),
  ageMin: smallint('age_min').notNull(),
  ageMax: smallint('age_max').notNull(),
  maxDistance: maxDistanceEnum('max_distance').notNull(),
  isComplete: boolean('is_complete').notNull(),
});

export const photos = pgTable('photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  storageKey: text('storage_key').notNull(),
  position: smallint('position').notNull(),
  status: photoStatus('status').notNull(),
  uploadedAt: tz('uploaded_at').notNull().defaultNow(),
  checkedAt: tz('checked_at'),
});

export const offsites = pgTable('offsites', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  coverKey: text('cover_key'),
  venueName: text('venue_name').notNull(),
  venueAddress: text('venue_address').notNull(),
  cityId: text('city_id').notNull(),
  startsAt: tz('starts_at').notNull(),
  endsAt: tz('ends_at').notNull(),
  capacity: integer('capacity'),
  status: offsiteStatus('status').notNull().default('draft'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdBy: uuid('created_by'),
  createdAt: tz('created_at').notNull().defaultNow(),
  publishedAt: tz('published_at'),
  updatedAt: tz('updated_at').notNull().defaultNow(),
  cancelledAt: tz('cancelled_at'),
});

export const profileReviews = pgTable('profile_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  attempt: smallint('attempt').notNull(),
  submittedAt: tz('submitted_at').notNull().defaultNow(),
  dueAt: tz('due_at').notNull(),
  outcome: reviewOutcome('outcome').notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedAt: tz('decided_at'),
  reason: text('reason'),
  explanation: text('explanation'),
  appealDeadlineAt: tz('appeal_deadline_at'),
});

export const blockedHashes = pgTable('blocked_hashes', {
  hash: text('hash').primaryKey(),
  type: hashType('type').notNull(),
  source: blockedHashSource('source').notNull(),
  expiresAt: tz('expires_at').notNull(),
  reviewId: uuid('review_id'),
});

export const otpCodes = pgTable('otp_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  recipientHash: text('recipient_hash').notNull(),
  purpose: otpPurpose('purpose').notNull(),
  codeHash: text('code_hash').notNull(),
  ipHash: text('ip_hash'),
  attempts: smallint('attempts').notNull().default(0),
  createdAt: tz('created_at').notNull().defaultNow(),
  expiresAt: tz('expires_at').notNull(),
  consumedAt: tz('consumed_at'),
  cancelledAt: tz('cancelled_at'),
});

export const authNonces = pgTable('auth_nonces', {
  nonceHash: text('nonce_hash').primaryKey(),
  createdAt: tz('created_at').notNull().defaultNow(),
  expiresAt: tz('expires_at').notNull(),
  consumedAt: tz('consumed_at'),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  refreshHash: text('refresh_hash').notNull(),
  scope: sessionScope('scope').notNull(),
  signInMethod: signInMethod('sign_in_method').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
  lastRefreshedAt: tz('last_refreshed_at'),
  expiresAt: tz('expires_at').notNull(),
  revokedAt: tz('revoked_at'),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: auditType('type').notNull(),
  action: auditAction('action').notNull(),
  operatorId: uuid('operator_id'),
  sessionId: uuid('session_id'),
  objectType: text('object_type'),
  objectId: text('object_id'),
  explanation: text('explanation'),
  details: jsonb('details').notNull().default({}),
  performedAt: tz('performed_at').notNull().defaultNow(),
});

export const chatKeys = pgTable('chat_keys', {
  matchId: uuid('match_id').primaryKey(),
  encryptedKey: bytea('encrypted_key').notNull(),
  keyVersion: text('key_version').notNull(),
});
