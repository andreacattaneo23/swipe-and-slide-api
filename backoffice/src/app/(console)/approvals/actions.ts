'use server';

/**
 * Gestori lato server della coda delle approvazioni (D141–D144). Il rifiuto chiede il motivo
 * dall'elenco, il testo per l'utente, che lo vede solo nell'app (D142), e la motivazione per
 * l'audit; anche l'approvazione chiede la motivazione (D91, contratto). Le foto nuove dopo
 * l'approvazione si approvano o si rifiutano con la motivazione (D143).
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { REJECTION_REASONS, type RejectionReason } from '@/server/admin-api';
import { explanationError, field, perform, userTextError } from '@/server/perform';

export async function decideApproval(_prev: FormState, formData: FormData): Promise<FormState> {
  const reviewId = field(formData, 'reviewId');
  const decision = field(formData, 'decision');
  const reason = field(formData, 'reason');
  const explanation = field(formData, 'explanation');
  const userExplanation = field(formData, 'userExplanation', 1000);
  const reject = decision === 'reject';
  let blocked = false;
  const state = await perform(
    'approvals',
    {
      values: { reason, explanation, userExplanation },
      errors: {
        form:
          decision === 'approve' || decision === 'reject'
            ? undefined
            : t('backoffice.error.required'),
        reason:
          reject && !REJECTION_REASONS.includes(reason as RejectionReason)
            ? t('backoffice.error.reason')
            : undefined,
        userExplanation: reject ? userTextError(userExplanation) : undefined,
        explanation: explanationError(explanation),
      },
      revalidate: ['/approvals'],
    },
    async (api, token) => {
      if (!reject) {
        await api.approveProfile(token, reviewId, { explanation });
        return 'backoffice.approvalQueue.approved';
      }
      const result = await api.rejectProfile(token, reviewId, {
        reason: reason as RejectionReason,
        explanation,
        userExplanation,
      });
      blocked = result.blocked;
      return 'backoffice.approvalQueue.rejected';
    },
  );
  if (state.status !== 'success') return state;
  redirect(`/approvals?done=${reject ? (blocked ? 'blocked' : 'rejected') : 'approved'}`);
}

export async function decideNewPhotoAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const photoId = field(formData, 'photoId');
  const outcome = field(formData, 'outcome') === 'approved' ? 'approved' : 'rejected';
  const explanation = field(formData, 'explanation');
  return perform(
    'approvals',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: ['/approvals'],
    },
    async (api, token) => {
      await api.decideNewPhoto(token, photoId, { outcome, explanation });
      return outcome === 'approved'
        ? 'backoffice.newPhotos.approved'
        : 'backoffice.newPhotos.rejected';
    },
  );
}
