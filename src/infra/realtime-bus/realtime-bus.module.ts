import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ChannelState, RedisChannelState } from './channel-state';
import { RealtimeBus, RedisRealtimeBus } from './realtime-bus';

const redisUrl = (config: AppConfig): string => {
  if (!config.redisUrl)
    throw new Error('REDIS_URL mancante: il tempo reale usa Redis (D182, D240)');
  return config.redisUrl;
};

/**
 * Bus degli eventi e stato dei canali su Redis (D182, D229, D240), `REDIS_URL` obbligatoria.
 * Usato da `app-api`, dai processi e da `realtime`, che non legge il database.
 */
@Global()
@Module({
  providers: [
    {
      provide: RealtimeBus,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new RedisRealtimeBus(redisUrl(config)),
    },
    {
      provide: ChannelState,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new RedisChannelState(redisUrl(config)),
    },
  ],
  exports: [RealtimeBus, ChannelState],
})
export class RealtimeBusModule implements OnApplicationShutdown {
  constructor(
    @Inject(RealtimeBus) private readonly bus: RealtimeBus,
    @Inject(ChannelState) private readonly state: ChannelState,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
    await this.state.close();
  }
}
