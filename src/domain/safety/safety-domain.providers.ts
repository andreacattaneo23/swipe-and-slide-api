import { CompanyOperationsService } from '../companies/company-operations.service';
import { WaitlistService } from '../companies/waitlist.service';
import { AgeVerificationService } from './age-verification.service';
import { AppealsService } from './appeals.service';
import { ChatAccessService } from './chat-access.service';
import { ContentCryptoService } from './content-crypto.service';
import { ModerationService } from './moderation.service';
import { NoticesService } from './notices.service';
import { PhotoReviewService } from './photo-review.service';
import { ReportsService } from './reports.service';
import { SafetySettings } from './safety-settings.service';
import { SanctionsService } from './sanctions.service';
import { StoreReviewService } from './store-review.service';
import { UserAdminService } from './user-admin.service';
import { WordFilterService } from './word-filter.service';
import { NotifyingUserEvents } from '../notifications/domain-notifiers';
import { UserEvents } from './user-events';

const SERVICES = [
  SafetySettings,
  NoticesService,
  WordFilterService,
  ContentCryptoService,
  ReportsService,
  SanctionsService,
  AppealsService,
  AgeVerificationService,
  ModerationService,
  PhotoReviewService,
  ChatAccessService,
  UserAdminService,
  StoreReviewService,
  CompanyOperationsService,
  WaitlistService,
];

/**
 * Servizi di dominio di sicurezza, moderazione, approvazione e amministrazione (team B3, D239),
 * forniti da `DomainModule` e usati da `app-api`, `admin-api` e dai processi pianificati.
 */
export const SAFETY_DOMAIN_PROVIDERS = [
  ...SERVICES,
  { provide: UserEvents, useClass: NotifyingUserEvents },
];

export const SAFETY_DOMAIN_EXPORTS = [...SERVICES, UserEvents];
