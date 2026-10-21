import { DynamicModule, Module } from '@nestjs/common';
import { HealthController } from '../core/health/health.controller';
import { AppConfig } from '../infra/config/config';
import { ConfigModule } from '../infra/config/config.module';
import { feedChatConfigProvider } from '../infra/feed-chat/feed-chat.config';
import { RealtimeBusModule } from '../infra/realtime-bus/realtime-bus.module';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Modulo radice di `realtime` (SERVICE_ROLE=realtime, D182): gateway WebSocket su `/ws`, eventi da
 * Redis e stato tecnico dei canali nella cache L2; nessun accesso al database (lo vieta anche
 * ESLint).
 */
@Module({})
export class RealtimeServerModule {
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: RealtimeServerModule,
      imports: [ConfigModule.forRoot(config), RealtimeBusModule],
      controllers: [HealthController],
      providers: [feedChatConfigProvider, RealtimeGateway],
    };
  }
}
