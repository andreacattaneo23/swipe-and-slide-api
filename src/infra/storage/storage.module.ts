import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { OBJECT_STORAGE } from './object-storage';
import { S3ObjectStorage } from './s3-object-storage';

/** Archivio degli oggetti (D46, D83, D240): MinIO in locale, R2 in produzione, client S3. */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new S3ObjectStorage(config.storage),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
