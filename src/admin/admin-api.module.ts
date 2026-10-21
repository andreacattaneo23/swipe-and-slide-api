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
import { CompaniesController } from './companies/companies.controller';
import { OffsitesController } from './offsites/offsites.controller';
import { AppealsController } from './appeals/appeals.controller';
import { CompanyOperationsController } from './companies/company-operations.controller';
import { ModerationController } from './moderation/moderation.controller';
import { AdminToolsController } from './tools/admin-tools.controller';
import { AdminToolsService } from './tools/admin-tools.service';
import { AccessAssertionService } from './auth/access-assertion.service';
import { UsersController } from './users/users.controller';

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
        CompanyOperationsController,
        ModerationController,
        UsersController,
        AppealsController,
        AdminToolsController,
      ],
      providers: [
        OperatorTokenService,
        OperatorAuthService,
        AdminToolsService,
        AccessAssertionService,
        { provide: APP_GUARD, useClass: OperatorGuard },
      ],
    };
  }
}
