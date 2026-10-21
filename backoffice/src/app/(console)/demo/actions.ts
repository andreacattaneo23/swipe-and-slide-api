'use server';

/**
 * Finestre di revisione degli store e dati dimostrativi (D42): apertura con la motivazione e la
 * durata (al massimo 14 giorni), codice mostrato una sola volta, chiusura, azzeramento dei dati
 * dimostrativi con la motivazione (architettura, "Altre regole"; senza secondo fattore, D244).
 */
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { explanationError, field, perform } from '@/server/perform';

const MAX_DAYS = 14;

export async function openWindowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const store = field(formData, 'store');
  const rawDays = field(formData, 'days', 3);
  const days = Number(rawDays);
  const explanation = field(formData, 'explanation');
  return perform(
    'demo',
    {
      values: { store, days: rawDays, explanation },
      errors: {
        store: store === 'apple' || store === 'google' ? undefined : t('backoffice.error.required'),
        days:
          Number.isInteger(days) && days >= 1 && days <= MAX_DAYS
            ? undefined
            : t('backoffice.error.range'),
        explanation: explanationError(explanation),
      },
      revalidate: ['/demo'],
    },
    async (api, token) => {
      const opened = await api.openReviewWindow(token, {
        store: store as 'apple' | 'google',
        days,
        explanation,
      });
      return {
        status: 'success',
        message: t('backoffice.demo.opened'),
        result: [{ label: t('backoffice.demo.code'), value: opened.code }],
      };
    },
  );
}

export async function closeWindowAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const windowId = field(formData, 'windowId');
  const explanation = field(formData, 'explanation');
  return perform(
    'demo',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: ['/demo'],
    },
    async (api, token) => {
      await api.closeReviewWindow(token, windowId, { explanation });
      return 'backoffice.demo.closed';
    },
  );
}

export async function resetDemoAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const windowId = field(formData, 'windowId');
  const explanation = field(formData, 'explanation');
  return perform(
    'demo',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: ['/demo'],
    },
    async (api, token) => {
      await api.resetDemoData(token, windowId, { explanation });
      return 'backoffice.demo.reset.done';
    },
  );
}
