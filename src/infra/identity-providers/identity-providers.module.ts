import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import {
  PROVIDER_KEYS,
  ProviderTokenVerifier,
  remoteProviderKeys,
} from './provider-token-verifier';

@Global()
@Module({
  providers: [
    {
      provide: PROVIDER_KEYS,
      inject: [APP_CONFIG],
      useFactory: remoteProviderKeys as (c: AppConfig) => unknown,
    },
    ProviderTokenVerifier,
  ],
  exports: [ProviderTokenVerifier],
})
export class IdentityProvidersModule {}
