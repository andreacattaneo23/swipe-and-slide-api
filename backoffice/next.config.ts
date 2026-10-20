import type { NextConfig } from 'next';

/**
 * Configurazione del backoffice (D92, D116): build `standalone` per l'immagine di Cloud Run,
 * nessuna intestazione che riveli il framework. La CSP con il nonce la imposta `src/proxy.ts`;
 * qui le intestazioni di sicurezza che valgono per ogni risposta, anche per i file statici.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Nessun file di istruzioni per strumenti esterni generato da next dev nel repository.
  agentRules: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
