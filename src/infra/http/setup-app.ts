import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { APP_CONFIG, AppConfig } from '../config/config';
import { ErrorFilter } from './error.filter';
import { devCors } from './dev-cors';
import { webDeletionCors } from './web-deletion-cors';

/**
 * Misure comuni della superficie HTTP (D231): `helmet`, `X-Powered-By` tolto, corpo JSON al
 * massimo 100 KB, validazione globale con `whitelist` e `forbidNonWhitelisted`, risposte
 * personali `no-store`, CORS solo per la cancellazione dal sito e, in sviluppo, per l'app web
 * (`CORS_DEV_ORIGINS`), formato unico degli errori.
 */
export function setupApp(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance() as { disable(name: string): void };
  server.disable('x-powered-by');
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  const config = app.get<AppConfig>(APP_CONFIG, { strict: false });
  if (config?.serviceRole === 'app') {
    // App web in sviluppo (export di Expo): solo le origini elencate, mai in produzione
    if (config.nodeEnv !== 'production' && config.devCorsOrigins.length > 0) {
      app.use(devCors(config.devCorsOrigins));
    }
    app.use(webDeletionCors(config.corsAllowedOrigins));
  }
  app.use(json({ limit: '100kb' }));
  // Solo il ritorno del flusso web di Apple arriva come modulo (`form_post`, D228)
  app.use('/auth/apple/web-callback', urlencoded({ extended: false, limit: '20kb' }));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
}
