import { Global, Module } from '@nestjs/common';
import { RateLimiter } from './rate-limiter';

@Global()
@Module({ providers: [RateLimiter], exports: [RateLimiter] })
export class CacheModule {}
