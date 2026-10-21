'use server';

/**
 * Risposta a un gruppo di richieste della lista d'attesa (D95, P13): un testo neutro uguale nella
 * forma per l'azienda aggiunta o no, poi le richieste si cancellano. Motivazione nell'audit (D91).
 */
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { explanationError, field, perform } from '@/server/perform';

export async function respondWaitlistAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const groupId = field(formData, 'groupId');
  const outcome = field(formData, 'outcome');
  const explanation = field(formData, 'explanation');
  return perform(
    'requests',
    {
      values: { outcome, explanation },
      errors: {
        outcome:
          outcome === 'added' || outcome === 'not_added'
            ? undefined
            : t('backoffice.error.required'),
        explanation: explanationError(explanation),
      },
      revalidate: ['/requests'],
    },
    async (api, token) => {
      await api.respondWaitlist(token, groupId, {
        outcome: outcome as 'added' | 'not_added',
        explanation,
      });
      return 'backoffice.requests.answered';
    },
  );
}
