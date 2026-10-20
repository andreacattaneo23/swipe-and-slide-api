import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals/approvals.service';
import { CompaniesService } from './companies/companies.service';
import { OffsitesService } from './offsites/offsites.service';
import { OtpService } from './otp/otp.service';

/** Servizi di dominio senza controller, usati da `app-api` e `admin-api` (D231). */
@Module({
  providers: [CompaniesService, OtpService, ApprovalsService, OffsitesService],
  exports: [CompaniesService, OtpService, ApprovalsService, OffsitesService],
})
export class DomainModule {}
