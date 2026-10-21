import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { ManualReviewPhotoChecker, PHOTO_CHECKER, VisionPhotoChecker } from './photo-checker';

/** Vision con `GOOGLE_APPLICATION_CREDENTIALS`; senza, solo la revisione manuale (D240). */
@Global()
@Module({
  providers: [
    {
      provide: PHOTO_CHECKER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.visionCredentials
          ? new VisionPhotoChecker(config.visionEndpoint)
          : new ManualReviewPhotoChecker(),
    },
  ],
  exports: [PHOTO_CHECKER],
})
export class PhotoCheckModule {}
