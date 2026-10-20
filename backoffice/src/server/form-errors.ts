/**
 * Traduzione degli errori di admin-api nei messaggi dei moduli. Nessun dettaglio tecnico arriva al
 * browser: solo i testi del backoffice. Una sessione scaduta riporta all'accesso.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { t, tCount, type TextKey } from '@/texts';
import { AdminApiError } from './admin-api';

const FIELD_MESSAGES: Record<string, TextKey> = {
  explanation: 'backoffice.error.explanation',
  reason: 'backoffice.error.reason',
  confirmName: 'backoffice.error.name',
  domains: 'backoffice.error.domain',
  endsAt: 'backoffice.offsiteForm.error.dates',
};

export function errorState(error: unknown, values?: FormState['values']): FormState {
  if (!(error instanceof AdminApiError)) {
    console.error('[backoffice] errore inatteso', error);
    return { status: 'error', message: t('error.generic.serious'), values };
  }
  const message = (key: TextKey): FormState => ({ status: 'error', message: t(key), values });
  switch (error.code) {
    case 'unauthorized':
      redirect('/login');
    case 'forbidden':
      return message('backoffice.error.forbidden');
    case 'invalid_code':
      return {
        status: 'error',
        fieldErrors: { code: tCount('code.wrong', error.details.remainingAttempts ?? 0) },
        values,
      };
    case 'code_expired':
      return message('backoffice.signIn.expired');
    case 'too_many_attempts':
      return message('code.attempts');
    case 'invalid_totp':
      return { status: 'error', fieldErrors: { totpCode: t('backoffice.error.totp') }, values };
    case 'validation': {
      const field = error.details.field ?? '';
      const key = FIELD_MESSAGES[field] ?? 'backoffice.error.required';
      return { status: 'error', fieldErrors: { [field || 'form']: t(key) }, values };
    }
    case 'conflict':
      if (error.details.field === 'domains') {
        return {
          status: 'error',
          fieldErrors: { domains: t('backoffice.error.domainTaken') },
          values,
        };
      }
      return message('backoffice.error.conflict');
    case 'not_found':
      return message('backoffice.error.conflict');
    case 'unavailable':
      return message('error.generic.serious');
  }
}
