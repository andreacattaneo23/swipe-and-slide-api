import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig } from '../infra/config/config';
import { InfraModule } from '../infra/infra.module';
import { HealthController } from '../core/health/health.controller';
import { DomainModule } from '../domain/domain.module';
import { ApprovalsController } from './approvals/approvals.controller';
import { OperatorAuthController } from './auth/operator-auth.controller';
import { OperatorAuthService } from './auth/operator-auth.service';
import { OperatorGuard } from './auth/operator.guard';
import { OperatorTokenService } from './auth/operator-token.service';
import { TotpService } from './auth/totp.service';
import { CompaniesController } from './companies/companies.controller';
import { OffsitesController } from './offsites/offsites.controller';

/**
 * Modulo radice di `admin-api` (SERVICE_ROLE=admin): API di amministrazione per il backoffice,
 * con l'identità dell'operatore verificata a ogni richiesta (D231). In produzione il ruolo del
 * database è `backoffice_role` (D90).
 */
@Module({})
export class AdminApiModule {
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: AdminApiModule,
      imports: [InfraModule.forRoot(config), DomainModule],
      controllers: [
        HealthController,
        OperatorAuthController,
        CompaniesController,
        ApprovalsController,
        OffsitesController,
      ],
      providers: [
        OperatorTokenService,
        TotpService,
        OperatorAuthService,
        { provide: APP_GUARD, useClass: OperatorGuard },
      ],
    };
  }
}
