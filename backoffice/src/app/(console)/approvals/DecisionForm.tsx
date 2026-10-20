'use client';

import { useActionState } from 'react';
import { Button, FormMessage, Note, RequiredLabel, Select, TextArea } from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { t, type TextKey } from '@/texts';
import { REVIEW_REASONS, type ReviewReason } from '@/server/admin-api/types';
import { decideApproval } from './actions';

/** Testi dei motivi del rifiuto: "Foto non conforme" da testi.js, gli altri [Proposta]. */
export const REASON_TEXTS: Record<ReviewReason, TextKey> = {
  non_compliant_photo: 'reason.photos',
  inappropriate_photos: 'reason.inappropriatePhotos',
  fake_profile: 'reason.fakeProfile',
  disallowed_text: 'reason.disallowedText',
  reveals_company_or_clients: 'reason.revealsCompany',
};

/** Esito della revisione (mockup 18c): motivo, motivazione, rifiuta o approva. */
export function DecisionForm({ reviewId }: { reviewId: string }) {
  const [state, action, pending] = useActionState(decideApproval, initialFormState);
  return (
    <form action={action} className="decision" noValidate>
      <h3 className="decision__title">{t('backoffice.approvalQueue.outcome')}</h3>
      <input type="hidden" name="reviewId" value={reviewId} />
      <div className="decision__fields">
        <Select
          label={t('backoffice.approvalQueue.reason')}
          name="reason"
          defaultValue={state.values?.reason ?? ''}
          error={state.fieldErrors?.reason}
        >
          <option value="">{t('backoffice.approvalQueue.reason.placeholder')}</option>
          {REVIEW_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {t(REASON_TEXTS[reason])}
            </option>
          ))}
        </Select>
        <TextArea
          label={
            <RequiredLabel
              label={t('backoffice.removalModal.explanation')}
              note={t('backoffice.removalModal.required')}
            />
          }
          name="explanation"
          required
          rows={2}
          defaultValue={state.values?.explanation}
          error={state.fieldErrors?.explanation}
        />
      </div>
      <Note icon="info">{t('backoffice.approvalQueue.appOnly')}</Note>
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
