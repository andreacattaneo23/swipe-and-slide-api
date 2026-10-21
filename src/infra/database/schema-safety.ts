// Schema Drizzle delle tabelle di sicurezza, moderazione e amministrazione (team B3, migrazioni
// 0300–0303). Separato da `schema.ts` per tenere distinti i domini; come `schema.ts` riporta le
// colonne delle migrazioni SQL, che restano la fonte del modello.
import {
  boolean,
  customType,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const reportReason = pgEnum('report_reason', [
  'fake_profile',
  'inappropriate_photos',
  'harassment',
  'spam_scam',
  'possible_minor',
  'works_at_my_company',
  'other',
]);
export const reportSource = pgEnum('report_source', ['feed', 'match', 'chat']);
export const reportSeverity = pgEnum('report_severity', ['severe', 'standard']);
export const sanctionType = pgEnum('sanction_type', [
  'warning',
  'disciplinary_suspension',
  'precautionary_suspension',
  'expulsion',
]);
export const severeCase = pgEnum('severe_case', [
  'threats_violence',
  'minor_content',
  'fraud',
  'stalking',
  'colleague_rule_evasion',
  'false_statements',
]);
export const moderationDecision = pgEnum('moderation_decision', [
  'dismissed',
  'content_removed',
  'match_closed',
  'warning',
  'disciplinary_suspension',
  'expulsion',
]);
export const appealOutcome = pgEnum('appeal_outcome', ['pending', 'accepted', 'rejected']);
export const reportContentType = pgEnum('report_content_type', [
  'message',
  'profile_text',
  'photo',
]);
export const reviewStore = pgEnum('review_store', ['apple', 'google']);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id'),
  reportedId: uuid('reported_id'),
  reason: reportReason('reason').notNull(),
  text: text('text'),
  source: reportSource('source').notNull(),
  fromMatch: boolean('from_match').notNull().default(false),
  severity: reportSeverity('severity').notNull().default('standard'),
  status: text('status').notNull().default('open'),
  dueAt: tz('due_at').notNull(),
  outcome: moderationDecision('outcome'),
  genericOutcomeAt: tz('generic_outcome_at'),
  createdAt: tz('created_at').notNull().defaultNow(),
  matchId: uuid('match_id'),
  reporterCompanyId: uuid('reporter_company_id'),
  reportedCompanyId: uuid('reported_company_id'),
  containsThreats: boolean('contains_threats').notNull().default(false),
  isDemo: boolean('is_demo').notNull().default(false),
  decidedBy: uuid('decided_by'),
  decidedAt: tz('decided_at'),
  closedAt: tz('closed_at'),
  alertedAt: tz('alerted_at'),
  contentKey: bytea('content_key'),
  contentKeyVersion: text('content_key_version'),
});

export const reportContents = pgTable('report_contents', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id').notNull(),
  type: reportContentType('type').notNull(),
  byReported: boolean('by_reported'),
  sourceAt: tz('source_at'),
  field: text('field'),
  ciphertext: bytea('ciphertext'),
  nonce: bytea('nonce'),
  storageKey: text('storage_key'),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const sanctions = pgTable('sanctions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  type: sanctionType('type').notNull(),
  severeCase: severeCase('severe_case'),
  reportId: uuid('report_id'),
  explanation: text('explanation').notNull(),
  decidedBy: uuid('decided_by'),
  startsAt: tz('starts_at').notNull().defaultNow(),
  endsAt: tz('ends_at'),
  appealDeadlineAt: tz('appeal_deadline_at'),
  appealCodeHash: text('appeal_code_hash'),
  revokedAt: tz('revoked_at'),
  createdAt: tz('created_at').notNull().defaultNow(),
  notifiedAt: tz('notified_at'),
  endNotifiedAt: tz('end_notified_at'),
});

export const appeals = pgTable('appeals', {
  id: uuid('id').primaryKey().defaultRandom(),
  sanctionId: uuid('sanction_id'),
  reviewId: uuid('review_id'),
  text: text('text').notNull(),
  submittedAt: tz('submitted_at').notNull().defaultNow(),
  dueAt: tz('due_at').notNull(),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: tz('reviewed_at'),
  outcome: appealOutcome('outcome').notNull().default('pending'),
  explanation: text('explanation'),
});

export const ageVerifications = pgTable('age_verifications', {
  userId: uuid('user_id').primaryKey(),
  reportId: uuid('report_id'),
  requestedBy: uuid('requested_by'),
  requestedAt: tz('requested_at').notNull().defaultNow(),
  storageKey: text('storage_key'),
  uploadedAt: tz('uploaded_at'),
});

export const directoryAlerts = pgTable('directory_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterCompanyId: uuid('reporter_company_id').notNull(),
  reportedCompanyId: uuid('reported_company_id').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
  closedAt: tz('closed_at'),
  closedBy: uuid('closed_by'),
});

export const storeReviewWindows = pgTable('store_review_windows', {
  id: uuid('id').primaryKey().defaultRandom(),
  openedBy: uuid('opened_by'),
  openedAt: tz('opened_at').notNull().defaultNow(),
  closesAt: tz('closes_at').notNull(),
  codeHash: text('code_hash').notNull(),
  failedAttempts: smallint('failed_attempts').notNull().default(0),
  closedAt: tz('closed_at'),
  store: reviewStore('store').notNull().default('apple'),
});

export const userNotices = pgTable('user_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  template: text('template').notNull(),
  params: jsonb('params').notNull().default({}),
  createdAt: tz('created_at').notNull().defaultNow(),
  attempts: smallint('attempts').notNull().default(0),
});

export const waitlistNotices = pgTable('waitlist_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactEmail: text('contact_email').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
  attempts: smallint('attempts').notNull().default(0),
});

export const teamAlerts = pgTable('team_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  counts: jsonb('counts').notNull().default({}),
  createdAt: tz('created_at').notNull().defaultNow(),
  sentAt: tz('sent_at'),
});

export const waitlistRequests = pgTable('waitlist_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull(),
  suggestedName: text('suggested_name'),
  contactEmail: text('contact_email').notNull(),
  contactConfirmedAt: tz('contact_confirmed_at'),
  createdAt: tz('created_at').notNull().defaultNow(),
  expiresAt: tz('expires_at').notNull(),
});

export const configTable = pgTable('config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});
