import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json } from 'express';
import helmet from 'helmet';
import { ErrorFilter } from './error.filter';

/**
 * Misure comuni della superficie HTTP (D231): `helmet`, `X-Powered-By` tolto, corpo JSON al
 * massimo 100 KB, validazione globale con `whitelist` e `forbidNonWhitelisted`, risposte
 * personali `no-store`, CORS spento (l'app nativa non lo usa), formato unico degli errori.
 */
export function setupApp(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance() as { disable(name: string): void };
  server.disable('x-powered-by');
  app.use(helmet({ referrerPolicy: { policy: 'no-referrer' } }));
  app.use(json({ limit: '100kb' }));
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
