import type { NextFunction, Request, Response } from 'express';

/**
 * CORS solo per l'origine del sito statico e solo sulle rotte `/web-deletion/*` (D231): l'API
 * dell'app non lo usa altrove e `admin-api` mai.
 */
export function webDeletionCors(origins: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith('/web-deletion/')) return next();
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(origin && origins.includes(origin) ? 204 : 403).end();
      return;
    }
    next();
  };
}
