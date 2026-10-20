import { DynamicModule, Module } from '@nestjs/common';
import { HealthController } from '../core/health/health.controller';
import { AppConfig } from '../infra/config/config';
import { ConfigModule } from '../infra/config/config.module';

/**
 * Modulo radice di `realtime` (SERVICE_ROLE=realtime, D182): per ora solo la salute.
 * [Da fare] Gateway WebSocket, sottoscrizione a Redis e canali personali; nessun accesso al
 * database (lo vieta anche ESLint).
 */
@Module({})
export class RealtimeServerModule {
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: RealtimeServerModule,
      imports: [ConfigModule.forRoot(config)],
      controllers: [HealthController],
    };
  }
}
