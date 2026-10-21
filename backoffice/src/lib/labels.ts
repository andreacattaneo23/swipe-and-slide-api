/**
 * Testi dei codici che arrivano da admin-api (stati, motivi, sanzioni, azioni dell'audit): i
 * codici restano quelli del glossario dell'architettura, i testi vengono solo da testi.js e dalle
 * proposte del backoffice.
 */
import type {
  AccountStatus,
  AppealSummary,
  CaseDecision,
  OffsiteStatus,
  RejectionReason,
  ReportReason,
  SanctionType,
  StatKey,
  TaxonomyId,
} from '@/server/admin-api/types';
import { hasText, t, type TextKey } from '@/texts';

export const ACCOUNT_STATUS: Record<AccountStatus, TextKey> = {
  registering: 'backoffice.status.registering',
  pending_approval: 'backoffice.status.pendingApproval',
  active: 'backoffice.status.active',
  reverifying: 'backoffice.status.reverifying',
  suspended: 'backoffice.status.suspended',
  deleted: 'backoffice.status.deleted',
};

export const REPORT_REASON: Record<ReportReason, TextKey> = {
  fake_profile: 'report.fakeProfile',
  inappropriate_photos: 'report.inappropriatePhotos',
  harassment: 'report.harassment',
  spam_scam: 'report.spamScam',
  possible_minor: 'report.possibleMinor',
  works_at_my_company: 'report.worksAtMyCompany',
  other: 'report.other',
};

/** Motivi del rifiuto: "Foto non conforme" e "Altro" da testi.js, gli altri [Proposta]. */
export const REJECTION_REASON: Record<RejectionReason, TextKey> = {
  inappropriate_photos: 'reason.inappropriatePhotos',
  photos_without_person: 'reason.photos',
  fake_profile: 'reason.fakeProfile',
  text_not_allowed: 'reason.disallowedText',
  reveals_company_or_clients: 'reason.revealsCompany',
  other: 'report.other',
};

export const SANCTION: Record<SanctionType | 'third_rejection', TextKey> = {
  warning: 'backoffice.sanction.warning',
  disciplinary_suspension: 'backoffice.sanction.suspension',
  precautionary_suspension: 'backoffice.sanction.precautionary',
  expulsion: 'backoffice.sanction.expulsion',
  third_rejection: 'backoffice.sanction.thirdRejection',
};

export const CASE_DECISION: Record<CaseDecision, TextKey> = {
  dismiss: 'backoffice.moderation.decision.dismiss',
  remove_content: 'backoffice.moderation.decision.removeContent',
  warning: 'backoffice.sanction.warning',
  disciplinary_suspension: 'backoffice.sanction.suspension',
  expulsion: 'backoffice.sanction.expulsion',
};

export const OFFSITE_STATUS: Record<OffsiteStatus, TextKey> = {
  draft: 'backoffice.offsiteForm.draft',
  published: 'backoffice.offsites.published',
  cancelled: 'offsite.cancelled',
  completed: 'offsite.completed',
};

export const STAT: Record<StatKey, TextKey> = {
  activeUsers: 'backoffice.stats.activeUsers',
  pendingApprovals: 'backoffice.stats.pendingApprovals',
  registrations7d: 'backoffice.stats.registrations7d',
  matches7d: 'backoffice.stats.matches7d',
  reports7d: 'backoffice.stats.reports7d',
  openSpaceActive: 'backoffice.stats.openSpaceActive',
  companies: 'backoffice.stats.companies',
  offsitesPublished: 'backoffice.stats.offsitesPublished',
};

export const TAXONOMY: Record<TaxonomyId, TextKey> = {
  interests: 'backoffice.config.interests',
  practiceAreas: 'backoffice.config.practiceAreas',
  lookingFor: 'backoffice.config.lookingFor',
  profileQuestions: 'backoffice.config.profileQuestions',
};

export function appealSubject(subject: AppealSummary['subject']): string {
  return t(SANCTION[subject]);
}

/** Testo di un'azione dell'audit; un codice nuovo, senza testo, si mostra così com'è. */
export function auditAction(action: string): string {
  const key = `backoffice.audit.action.${action}`;
  return hasText(key) ? t(key) : action;
}

/** Testo di un limite della configurazione; una chiave nuova si mostra così com'è. */
export function limitLabel(key: string): string {
  const textKey = `backoffice.config.limit.${key}`;
  return hasText(textKey) ? t(textKey) : key;
}
