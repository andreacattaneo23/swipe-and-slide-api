import { NextResponse, type NextRequest } from 'next/server';

/**
 * Intestazioni di sicurezza delle pagine (D231, OWASP API8): CSP rigorosa con un nonce nuovo a
 * ogni richiesta (script e stili solo del server Next), nessuna cache delle pagine con dati
 * personali. Le altre intestazioni sono in next.config.ts.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // In sviluppo gli strumenti di Next.js applicano stili in linea: solo lì 'unsafe-inline'.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // Le foto in revisione arrivano da URL firmati dell'archivio (ADMIN_PHOTOS_ORIGIN, D46).
    `img-src 'self' data: blob:${process.env.ADMIN_PHOTOS_ORIGIN ? ` ${process.env.ADMIN_PHOTOS_ORIGIN}` : ''}`,
    "font-src 'self'",
    `connect-src 'self'${isDev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|brand/|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
