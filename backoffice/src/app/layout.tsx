import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { t } from '@/texts';
import '@/design/tokens.css';
import './backoffice.css';

// Font del brand dal kit (D103), copiati da npm run tokens: nessuna richiesta a servizi esterni.
const headings = localFont({
  src: [
    { path: '../design/fonts/Newsreader-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../design/fonts/Newsreader-Medium.ttf', weight: '500', style: 'normal' },
  ],
  variable: '--font-headings',
  display: 'swap',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const body = localFont({
  src: [
    { path: '../design/fonts/NunitoSans-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../design/fonts/NunitoSans-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../design/fonts/NunitoSans-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
  fallback: ['Arial', 'Helvetica', 'sans-serif'],
});

export const metadata: Metadata = {
  title: `${t('brand.swipe')} ${t('brand.amp')} ${t('brand.slide')} · ${t('backoffice.name')}`,
  robots: { index: false, follow: false },
};

// Tutte le pagine sono dinamiche: dati personali, sessione e nonce della CSP a ogni richiesta.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="it" className={`${headings.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
