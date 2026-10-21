/**
 * Schema comune dei gestori lato server delle azioni degli operatori: operatore e ruolo della
 * sezione, controllo dei campi per dare subito l'errore, chiamata ad admin-api con il token
 * dell'operatore, traduzione degli errori, aggiornamento delle pagine. La verifica che conta resta
 * quella di admin-api (D231).
 */
import 'server-only';
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state';
import type { SectionId } from '@/lib/roles';
import { t, type TextKey } from '@/texts';
import { getAdminApi, type AdminApi } from './admin-api';
import { requireOperator } from './auth';
import { errorState } from './form-errors';

export const EXPLANATION_MIN = 3;
export const EXPLANATION_MAX = 500;
export const USER_TEXT_MAX = 1000;

/** Testo di un campo, senza spazi ai lati e tagliato alla lunghezza massima. */
export function field(formData: FormData, name: string, max = 4000): string {
  return String(formData.get(name) ?? '')
    .trim()
    .slice(0, max);
}

/** Motivazione obbligatoria (D91), con i limiti di ExplanationDto del contratto. */
export function explanationError(value: string): string | undefined {
  return value.length < EXPLANATION_MIN || value.length > EXPLANATION_MAX
    ? t('backoffice.error.explanation')
    : undefined;
}

/** Testo per l'utente (D142, DSA art. 17): obbligatorio, al massimo 1000 caratteri. */
export function userTextError(value: string): string | undefined {
  return value.length < EXPLANATION_MIN || value.length > USER_TEXT_MAX
    ? t('backoffice.error.userExplanation')
    : undefined;
}

export interface PerformOptions {
  /** Valori da rimettere nei campi dopo un errore. */
  values?: Record<string, string>;
  /** Errori già trovati sui campi: se ce n'è uno, admin-api non si chiama. */
  errors?: Record<string, string | undefined>;
  /** Messaggi propri del modulo per i campi segnalati da admin-api. */
  fields?: Partial<Record<string, TextKey>>;
  /** Pagine da aggiornare dopo il successo. */
  revalidate?: string[];
}

/**
 * Esegue un'azione della sezione. `run` restituisce il messaggio di successo (chiave dei testi) o
 * uno stato completo; un `redirect` lanciato dentro `run` passa oltre.
 */
export async function perform(
  section: SectionId,
  options: PerformOptions,
  run: (api: AdminApi, token: string) => Promise<TextKey | FormState>,
): Promise<FormState> {
  const { token } = await requireOperator(section);
  const fieldErrors = Object.fromEntries(
    Object.entries(options.errors ?? {}).filter(([, message]) => message !== undefined),
  ) as Record<string, string>;
  if (Object.keys(fieldErrors).length > 0) {
    return { status: 'error', fieldErrors, values: options.values };
  }
  let outcome: TextKey | FormState;
  try {
    outcome = await run(getAdminApi(), token);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    return errorState(error, { values: options.values, fields: options.fields });
  }
  for (const path of options.revalidate ?? []) revalidatePath(path);
  return typeof outcome === 'string' ? { status: 'success', message: t(outcome) } : outcome;
}

/** `redirect()` e `notFound()` di Next lanciano errori che non vanno trattati come guasti. */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    (typeof digest === 'string' && /^NEXT_(REDIRECT|HTTP_ERROR_FALLBACK|NOT_FOUND)/.test(digest)) ||
    (error instanceof Error && error.message.startsWith('redirect:'))
  );
}
