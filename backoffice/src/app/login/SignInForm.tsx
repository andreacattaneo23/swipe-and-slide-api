'use client';

import { useActionState } from 'react';
import { Button, FormMessage, TextInput } from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { t } from '@/texts';
import { requestCode, restartSignIn, verifySignIn } from './actions';

export type SignInStep = 'email' | 'verify';

/** Accesso in due passi: email, poi il codice ricevuto all'email (D88, D238, D244). */
export function SignInForm({ step, maskedEmail }: { step: SignInStep; maskedEmail: string }) {
  if (step === 'verify') return <VerifyStep maskedEmail={maskedEmail} />;
  return <EmailStep />;
}

function EmailStep() {
  const [state, action, pending] = useActionState(requestCode, initialFormState);
  return (
    <form action={action} className="sign-in__form" noValidate>
      <h1 className="sign-in__title">{t('backoffice.signIn.title')}</h1>
      <p className="sign-in__body">{t('backoffice.signIn.body')}</p>
      <TextInput
        label={t('signIn.email.label')}
        name="email"
        type="email"
        autoComplete="username"
        required
        placeholder={t('signIn.email.placeholder')}
        defaultValue={state.values?.email}
        error={state.fieldErrors?.email}
      />
      <FormMessage status={state.status} message={state.message} />
      <Button type="submit" disabled={pending}>
        {t('backoffice.signIn.send')}
      </Button>
      <p className="note">{t('backoffice.signIn.neutral')}</p>
    </form>
  );
}

function VerifyStep({ maskedEmail }: { maskedEmail: string }) {
  const [state, action, pending] = useActionState(verifySignIn, initialFormState);
  return (
    <>
      <form action={action} className="sign-in__form" noValidate>
        <h1 className="sign-in__title">{t('backoffice.signIn.code.title')}</h1>
        <p className="sign-in__body">{t('backoffice.signIn.code.body', { email: maskedEmail })}</p>
        <TextInput
          label={t('backoffice.signIn.code.label')}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          className="field--code"
          error={state.fieldErrors?.code}
        />
        <FormMessage status={state.status} message={state.message} />
        <Button type="submit" disabled={pending}>
          {t('backoffice.signIn.submit')}
        </Button>
      </form>
      <RestartButton />
    </>
  );
}

function RestartButton() {
  return (
    <form action={restartSignIn}>
      <Button type="submit" variant="link">
        {t('backoffice.signIn.restart')}
      </Button>
    </form>
  );
}
