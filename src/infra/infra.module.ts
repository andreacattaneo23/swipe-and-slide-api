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
import { PhotoCheckModule } from './photo-check/photo-check.module';
import { StorageModule } from './storage/storage.module';
import { FeedChatInfraModule } from './feed-chat/feed-chat-infra.module';
import { RealtimeBusModule } from './realtime-bus/realtime-bus.module';

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
        StorageModule,
        PhotoCheckModule,
        RealtimeBusModule,
        FeedChatInfraModule,
      ],
      providers: [Clock, CryptoService],
      exports: [Clock, CryptoService],
    };
  }
}
