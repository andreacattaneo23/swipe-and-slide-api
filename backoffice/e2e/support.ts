/**
 * Supporto delle prove end to end: codice dell'operatore letto dall'API di Mailpit, senza secondo
 * fattore (D244). Nessun dato finto (D240).
 */
import { expect, type Page } from '@playwright/test';

/** Sessione dell'operatore salvata dalla prova di accesso (`auth.setup.ts`), fuori da git. */
export const SESSION_FILE = 'playwright/.auth/operator.json';

export const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? 'admin@backoffice.example';
const MAILPIT = (process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025').replace(/\/+$/, '');

interface MailpitSummary {
  ID: string;
  Created: string;
  To: { Address: string }[];
}

/** Ultimo codice di 6 cifre arrivato a `to` dopo `since`, dall'API di Mailpit. */
export async function codeFromMailpit(to: string, since: Date): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
    expect(response.ok, 'API di Mailpit raggiungibile').toBe(true);
    const { messages } = (await response.json()) as { messages: MailpitSummary[] };
    const found = messages.find(
      (message) =>
        Date.parse(message.Created) >= since.getTime() - 1000 &&
        message.To.some((item) => item.Address.toLowerCase() === to.toLowerCase()),
    );
    if (found) {
      const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${found.ID}`)).json()) as {
        Text?: string;
        HTML?: string;
      };
      const code = /\b(\d{3})\s?(\d{3})\b/.exec(detail.Text ?? detail.HTML ?? '');
      if (code) return `${code[1]}${code[2]}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Nessun codice per ${to} in Mailpit entro 20 secondi`);
}

/** Accesso completo dell'operatore: email e codice da Mailpit (D244). */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  const since = new Date();
  await page.getByLabel('Email').fill(OPERATOR_EMAIL);
  await page.getByRole('button', { name: 'Invia il codice' }).click();
  await expect(page.getByLabel('Codice di verifica')).toBeVisible();
  const code = await codeFromMailpit(OPERATOR_EMAIL, since);
  await page.getByLabel('Codice di verifica').fill(code);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByRole('navigation', { name: 'Sezioni del backoffice' })).toBeVisible();
}
