import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig } from '../infra/config/config';
import { InfraModule } from '../infra/infra.module';
import { CoreRuleModule } from '../core/core-rule/core-rule.module';
import { VisibilityGuard } from '../core/core-rule/visibility.guard';
import { HealthController } from '../core/health/health.controller';
import { DomainModule } from '../domain/domain.module';
import { AccessGuard } from './auth/access.guard';
import { AccessTokenService } from './auth/access-token.service';
import { AuthController } from './auth/auth.controller';
import { NonceService } from './auth/nonce.service';
import { PersonalIdentitiesService } from './auth/personal-identities.service';
import { ProviderSignInService } from './auth/provider-sign-in.service';
import { RegistrationTicketService } from './auth/registration-ticket.service';
import { SessionsService } from './auth/sessions.service';
import { DirectoryController } from './directory/directory.controller';
import { MeController } from './me/me.controller';
import { RegistrationController } from './registration/registration.controller';
import { RegistrationService } from './registration/registration.service';

/**
 * Modulo radice di `app-api` (SERVICE_ROLE=app): solo i moduli dell'app, i servizi di dominio e
 * il nucleo; nessuna rotta di amministrazione (D231). Guard globali: accesso con gli ambiti,
 * poi la regola delle rotte che espongono un altro utente.
 */
@Module({})
export class AppApiModule {
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: AppApiModule,
      imports: [InfraModule.forRoot(config), CoreRuleModule, DomainModule],
      controllers: [
        HealthController,
        AuthController,
        RegistrationController,
        MeController,
        DirectoryController,
      ],
      providers: [
        AccessTokenService,
        SessionsService,
        NonceService,
        PersonalIdentitiesService,
        ProviderSignInService,
        RegistrationTicketService,
        RegistrationService,
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_GUARD, useExisting: VisibilityGuard },
      ],
    };
  }
}
