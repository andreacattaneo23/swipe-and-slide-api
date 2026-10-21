import type { NextFunction, Request, Response } from 'express';

/**
 * CORS dell'app web in sviluppo (export di Expo su `localhost`): solo le origini elencate in
 * `CORS_DEV_ORIGINS`, mai `*`, nessun cookie (l'app usa il token nell'intestazione). In
 * produzione l'elenco è vuoto e questo middleware non si monta (D231).
 */
export function devCors(origins: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (!origin || !origins.includes(origin)) return next();
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, Retry-After');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, If-None-Match, Idempotency-Key',
      );
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}
