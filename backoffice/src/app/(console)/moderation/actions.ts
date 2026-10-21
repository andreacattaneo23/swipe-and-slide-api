'use server';

/**
 * Decisione su un caso di moderazione (D74, D75, D113): archiviazione, rimozione del contenuto o
 * sanzione, con la motivazione per l'audit (D91) e, per le sanzioni, il testo per l'utente (DSA,
 * art. 17). Chi ha segnalato riceve solo un esito generico (D113), lo manda admin-api.
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { CASE_DECISIONS, type CaseDecision } from '@/server/admin-api';
import { explanationError, field, perform, userTextError } from '@/server/perform';

const SANCTIONS: readonly CaseDecision[] = ['warning', 'disciplinary_suspension', 'expulsion'];

export async function decideCaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const caseId = field(formData, 'caseId');
  const decision = field(formData, 'decision') as CaseDecision;
  const explanation = field(formData, 'explanation');
  const userExplanation = field(formData, 'userExplanation', 1000);
  const sanction = SANCTIONS.includes(decision);
  const state = await perform(
    'moderation',
    {
      values: { decision, explanation, userExplanation },
      errors: {
        decision: CASE_DECISIONS.includes(decision) ? undefined : t('backoffice.error.required'),
        userExplanation: sanction ? userTextError(userExplanation) : undefined,
        explanation: explanationError(explanation),
      },
      revalidate: ['/moderation'],
    },
    async (api, token) => {
      await api.decideCase(token, caseId, {
        decision,
        explanation,
        userExplanation: sanction ? userExplanation : null,
      });
      return 'backoffice.moderation.decided';
    },
  );
  if (state.status === 'success') redirect('/moderation?done=1');
  return state;
}
