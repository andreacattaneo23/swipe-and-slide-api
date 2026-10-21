import { Module } from '@nestjs/common';
import { CoreRuleModule } from '../core/core-rule/core-rule.module';
import { AccountLifecycleService } from './account/account-lifecycle.service';
import { AccountMailer } from './account/account-mailer';
import { DataExportsService } from './account/data-exports.service';
import { ApprovalsService } from './approvals/approvals.service';
import { BlocksService } from './blocks/blocks.service';
import { CompaniesService } from './companies/companies.service';
import { ExcludedCompaniesService } from './excluded-companies/excluded-companies.service';
import { OffsitesService } from './offsites/offsites.service';
import { OpenSpaceService } from './open-space/open-space.service';
import { OtpService } from './otp/otp.service';
import { ParametersService } from './parameters/parameters.service';
import { PhotosService } from './photos/photos.service';
import { ProfileViewService } from './profiles/profile-view.service';
import { ProfilesService } from './profiles/profiles.service';
import { TaxonomiesService } from './taxonomies/taxonomies.service';
import { TripsService } from './trips/trips.service';
import { WorkIdentityService } from './work-identity/work-identity.service';
import { ChatCryptoService } from './chat-crypto/chat-crypto.service';
import { ACCOUNT_NOTIFIER } from './account/account-notifier';
import { PushAccountNotifier } from './notifications/domain-notifiers';
import { NotificationsService } from './notifications/notifications.service';
import { RealtimePublisher } from './realtime/realtime-publisher';
import { SAFETY_DOMAIN_EXPORTS, SAFETY_DOMAIN_PROVIDERS } from './safety/safety-domain.providers';

/** Servizi di dominio senza controller, usati da `app-api` e `admin-api` (D231). */
@Module({
  // La regola core serve anche ai servizi di dominio usati da `admin-api` e dai processi
  imports: [CoreRuleModule],
  providers: [
    CompaniesService,
    OtpService,
    ApprovalsService,
    OffsitesService,
    ParametersService,
    TaxonomiesService,
    PhotosService,
    ProfilesService,
    ProfileViewService,
    TripsService,
    OpenSpaceService,
    ExcludedCompaniesService,
    BlocksService,
    AccountMailer,
    WorkIdentityService,
    AccountLifecycleService,
    DataExportsService,
    RealtimePublisher,
    NotificationsService,
    ChatCryptoService,
    ...SAFETY_DOMAIN_PROVIDERS,
    { provide: ACCOUNT_NOTIFIER, useClass: PushAccountNotifier },
  ],
  exports: [
    CompaniesService,
    OtpService,
    ApprovalsService,
    OffsitesService,
    ParametersService,
    TaxonomiesService,
    PhotosService,
    ProfilesService,
    ProfileViewService,
    TripsService,
    OpenSpaceService,
    ExcludedCompaniesService,
    BlocksService,
    AccountMailer,
    WorkIdentityService,
    AccountLifecycleService,
    DataExportsService,
    RealtimePublisher,
    NotificationsService,
    ChatCryptoService,
    ...SAFETY_DOMAIN_EXPORTS,
    ACCOUNT_NOTIFIER,
  ],
})
export class DomainModule {}
