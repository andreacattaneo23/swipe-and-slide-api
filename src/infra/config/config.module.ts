import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig, loadConfig } from './config';

/** Modulo globale della configurazione; nei test si passa una configurazione già pronta. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config ?? loadConfig() }],
      exports: [APP_CONFIG],
    };
  }
}
