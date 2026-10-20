import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { BrevoEmailSender } from './brevo-email-sender';
import { EMAIL_SENDER } from './email-sender';
import { LogEmailSender } from './log-email-sender';

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.emailTransport === 'brevo') {
          if (!config.brevoApiKey) throw new Error('BREVO_API_KEY mancante');
          return new BrevoEmailSender(config.brevoApiKey, {
            neutral: config.emailFromNeutral,
            project: config.emailFromProject,
          });
        }
        return new LogEmailSender();
      },
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
