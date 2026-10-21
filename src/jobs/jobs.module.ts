import { DynamicModule, Module } from '@nestjs/common';
import { type AppConfig } from '../infra/config/config';
import { InfraModule } from '../infra/infra.module';
import { CoreRuleModule } from '../core/core-rule/core-rule.module';
import { DomainModule } from '../domain/domain.module';
import { ProfileAccountJobs } from './profile-account.jobs';

/** Contesto Nest dei processi pianificati (`daily-jobs`, `hourly-jobs`): ruolo `jobs_role`. */
@Module({})
export class JobsModule {
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: JobsModule,
      imports: [InfraModule.forRoot(config), CoreRuleModule, DomainModule],
      providers: [ProfileAccountJobs],
      exports: [ProfileAccountJobs],
    };
  }
}
