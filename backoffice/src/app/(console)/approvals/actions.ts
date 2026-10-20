'use server';

/**
 * Gestori lato server della coda delle approvazioni (D141–D144). Il rifiuto chiede il motivo
 * dall'elenco e la motivazione, che l'utente vede solo nell'app (D142); anche l'approvazione
 * chiede la motivazione, che resta solo nell'audit (D91, [Proposta]).
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { getAdminApi, REVIEW_REASONS, type ReviewReason } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { errorState } from '@/server/form-errors';

export async function decideApproval(_prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireOperator('approvals');
  const reviewId = String(formData.get('reviewId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const reason = String(formData.get('reason') ?? '');
  const explanation = String(formData.get('explanation') ?? '').trim();
  const values = { reason, explanation };

  const fieldErrors: Record<string, string> = {};
  if (!explanation) fieldErrors.explanation = t('backoffice.error.explanation');
  if (decision === 'reject' && !REVIEW_REASONS.includes(reason as ReviewReason)) {
    fieldErrors.reason = t('backoffice.error.reason');
  }
  if (decision !== 'approve' && decision !== 'reject')
    fieldErrors.form = t('backoffice.error.required');
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', fieldErrors, values };

  try {
    if (decision === 'approve') {
      await getAdminApi().approveProfile(token, reviewId, { explanation });
    } else {
      await getAdminApi().rejectProfile(token, reviewId, {
        reason: reason as ReviewReason,
        explanation,
      });
    }
  } catch (error) {
    return errorState(error, values);
  }
  revalidatePath('/approvals');
  redirect(`/approvals?done=${decision === 'approve' ? 'approved' : 'rejected'}`);
}
