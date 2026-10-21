'use client';

import { useActionState, useState } from 'react';
import { Button, FormMessage, Note, RequiredLabel, Select, TextArea } from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { REJECTION_REASON } from '@/lib/labels';
import { t } from '@/texts';
import { REJECTION_REASONS } from '@/server/admin-api/types';
import { decideApproval } from './actions';

/**
 * Esito della revisione (mockup 18c): motivo e testo per l'utente servono solo al rifiuto, la
 * motivazione per l'audit a entrambe le decisioni.
 */
export function DecisionForm({
  reviewId,
  lastAttempt,
}: {
  reviewId: string;
  lastAttempt: boolean;
}) {
  const [state, action, pending] = useActionState(decideApproval, initialFormState);
  const [reason, setReason] = useState(state.values?.reason ?? '');
  return (
    <form action={action} className="decision" noValidate>
      <h3 className="decision__title">{t('backoffice.approvalQueue.outcome')}</h3>
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="decision__fields">
        <Select
          label={t('backoffice.approvalQueue.reason')}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={state.fieldErrors?.reason}
        >
          <option value="">{t('backoffice.approvalQueue.reason.placeholder')}</option>
          {REJECTION_REASONS.map((item) => (
            <option key={item} value={item}>
              {t(REJECTION_REASON[item])}
            </option>
          ))}
        </Select>
        <TextArea
          label={t('backoffice.approvalQueue.userText')}
          hint={t('backoffice.approvalQueue.userText.hint')}
          name="userExplanation"
          rows={2}
          maxLength={1000}
          defaultValue={state.values?.userExplanation}
          error={state.fieldErrors?.userExplanation}
        />
        <TextArea
          label={
            <RequiredLabel
              label={t('backoffice.removalModal.explanation')}
              note={t('backoffice.removalModal.required')}
            />
          }
          hint={t('backoffice.explanation.hint')}
          name="explanation"
          required
          rows={2}
          maxLength={500}
          defaultValue={state.values?.explanation}
          error={state.fieldErrors?.explanation}
        />
      </div>
      <Note icon="info">{t('backoffice.approvalQueue.appOnly')}</Note>
      {lastAttempt ? <Note icon="alert">{t('backoffice.approvalQueue.lastAttempt')}</Note> : null}
      <Note icon="lock">{t('backoffice.removalModal.audit')}</Note>
      <FormMessage status={state.status} message={state.message ?? state.fieldErrors?.form} />
      <div className="decision__buttons">
        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="destructive"
          disabled={pending}
        >
          {t('backoffice.approvalQueue.reject')}
        </Button>
        <Button type="submit" name="decision" value="approve" icon="check" disabled={pending}>
          {t('backoffice.approvalQueue.approve')}
        </Button>
      </div>
    </form>
  );
}
