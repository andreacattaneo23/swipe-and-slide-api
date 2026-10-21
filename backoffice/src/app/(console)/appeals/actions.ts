'use server';

/**
 * Decisione su un ricorso (D75, D113): accolto o respinto, con la motivazione (D91). Il ricorso lo
 * esamina una persona diversa da chi ha deciso la sanzione (D197): lo controlla admin-api.
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { explanationError, field, perform } from '@/server/perform';

export async function decideAppealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const appealId = field(formData, 'appealId');
  const outcome = field(formData, 'outcome');
  const explanation = field(formData, 'explanation');
  const state = await perform(
    'appeals',
    {
      values: { outcome, explanation },
      errors: {
        outcome:
          outcome === 'upheld' || outcome === 'rejected'
            ? undefined
            : t('backoffice.error.required'),
        explanation: explanationError(explanation),
      },
      revalidate: ['/appeals'],
    },
    async (api, token) => {
      await api.decideAppeal(token, appealId, {
        outcome: outcome as 'upheld' | 'rejected',
        explanation,
      });
      return 'backoffice.appeals.decided';
    },
  );
  if (state.status === 'success') redirect('/appeals?done=1');
  return state;
}
