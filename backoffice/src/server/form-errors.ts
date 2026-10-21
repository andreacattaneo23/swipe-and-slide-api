/**
 * Traduzione degli errori di admin-api nei messaggi dei moduli. Nessun dettaglio tecnico arriva al
 * browser: solo i testi del backoffice. Una sessione scaduta riporta all'accesso.
 */
import 'server-only';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { t, tCount, type TextKey } from '@/texts';
import { AdminApiError } from './admin-api';

/** Messaggio di ogni campo citato da un errore di validazione. */
const FIELD_MESSAGES: Record<string, TextKey> = {
  explanation: 'backoffice.error.explanation',
  userExplanation: 'backoffice.error.userExplanation',
  reason: 'backoffice.error.reason',
  confirmName: 'backoffice.error.name',
  domains: 'backoffice.error.domain',
  domain: 'backoffice.error.domain',
  endsAt: 'backoffice.offsiteForm.error.dates',
  value: 'backoffice.error.range',
  days: 'backoffice.error.range',
  cover: 'backoffice.error.cover',
  targetCompanyId: 'backoffice.error.target',
};

/** Messaggio di ogni campo citato da un conflitto. */
const CONFLICT_MESSAGES: Record<string, TextKey> = {
  domains: 'backoffice.error.domainTaken',
  domain: 'backoffice.error.domainTaken',
  name: 'backoffice.error.nameTaken',
  targetCompanyId: 'backoffice.error.demoMix',
};

export interface ErrorOptions {
  values?: FormState['values'];
  /** Messaggi propri del modulo per i campi (es. l'identificativo dell'account). */
  fields?: Partial<Record<string, TextKey>>;
}

export function errorState(
  error: unknown,
  options: ErrorOptions | FormState['values'] = {},
): FormState {
  const { values, fields = {} } = isOptions(options) ? options : { values: options };
  if (!(error instanceof AdminApiError)) {
    console.error('[backoffice] errore inatteso', error);
    return { status: 'error', message: t('error.generic.serious'), values };
  }
  const message = (key: TextKey): FormState => ({ status: 'error', message: t(key), values });
  const field = error.details.field ?? '';
  switch (error.code) {
    case 'unauthorized':
      redirect('/login');
    case 'forbidden':
      return message('backoffice.error.forbidden');
    case 'invalid_code':
      return {
        status: 'error',
        fieldErrors: {
          code:
            error.details.remainingAttempts === undefined
              ? t('backoffice.signIn.invalid')
              : tCount('code.wrong', error.details.remainingAttempts),
        },
        values,
      };
    case 'code_expired':
      return message('backoffice.signIn.expired');
    case 'too_many_attempts':
      return message('code.attempts');
    case 'invalid_credentials':
      return message('backoffice.signIn.invalid');
    case 'validation': {
      const key = fields[field] ?? FIELD_MESSAGES[field] ?? 'backoffice.error.required';
      return { status: 'error', fieldErrors: { [field || 'form']: t(key) }, values };
    }
    case 'conflict': {
      const key = CONFLICT_MESSAGES[field];
      if (key) return { status: 'error', fieldErrors: { [field]: t(key) }, values };
      return message('backoffice.error.conflict');
    }
    case 'not_found':
      return message('backoffice.error.conflict');
    case 'unavailable':
      return message('error.generic.serious');
  }
}

function isOptions(value: ErrorOptions | FormState['values']): value is ErrorOptions {
  return !!value && ('fields' in value || 'values' in value);
}
