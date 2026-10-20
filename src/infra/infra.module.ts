import { DynamicModule, Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { CacheModule } from './cache/cache.module';
import { Clock } from './clock/clock';
import { AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { CryptoService } from './crypto/crypto.service';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { IdentityProvidersModule } from './identity-providers/identity-providers.module';

/** Servizi tecnici condivisi da `app-api` e `admin-api`. */
@Module({})
export class InfraModule {
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: InfraModule,
      global: true,
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule,
        EmailModule,
        AuditModule,
        CacheModule,
        IdentityProvidersModule,
      ],
      providers: [Clock, CryptoService],
      exports: [Clock, CryptoService],
    };
  }
}
