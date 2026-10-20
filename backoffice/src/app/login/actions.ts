'use server';

/**
 * Gestori lato server dell'accesso dell'operatore (D88, D231): email, codice all'email, TOTP.
 * Il browser parla solo con il server Next; il token della sessione resta nel cookie cifrato.
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { homeFor } from '@/lib/roles';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { errorState } from '@/server/form-errors';
import {
  clearSession,
  clearSignInFlow,
  readSession,
  readSignInFlow,
  saveSession,
  saveSignInFlow,
} from '@/server/session';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PATTERN = /^\d{6}$/;

/** Toglie spazi e trattini dal codice digitato ("482 913" → "482913"). */
function normalizeCode(value: FormDataEntryValue | null): string {
  return String(value ?? '').replace(/[\s-]/g, '');
}

export async function requestCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!EMAIL_PATTERN.test(email)) {
    return {
      status: 'error',
      fieldErrors: { email: t('backoffice.error.required') },
      values: { email },
    };
  }
  try {
    const challenge = await getAdminApi().requestSignInCode(email);
    await saveSignInFlow({
      challengeId: challenge.challengeId,
      maskedEmail: challenge.maskedEmail,
      step: 'code',
    });
  } catch (error) {
    return errorState(error, { email });
  }
  redirect('/login');
}

export async function verifyCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const flow = await readSignInFlow();
  if (!flow || flow.step !== 'code')
    return { status: 'error', message: t('backoffice.signIn.expired') };
  const code = normalizeCode(formData.get('code'));
  if (!CODE_PATTERN.test(code)) {
    return { status: 'error', fieldErrors: { code: t('backoffice.error.code') } };
  }
  try {
    const challenge = await getAdminApi().verifySignInCode(flow.challengeId, code);
    await saveSignInFlow({ ...flow, challengeId: challenge.challengeId, step: 'totp' });
  } catch (error) {
    return errorState(error);
  }
  redirect('/login');
}

export async function verifyTotp(_prev: FormState, formData: FormData): Promise<FormState> {
  const flow = await readSignInFlow();
  if (!flow || flow.step !== 'totp')
    return { status: 'error', message: t('backoffice.signIn.expired') };
  const totpCode = normalizeCode(formData.get('totpCode'));
  if (!CODE_PATTERN.test(totpCode)) {
    return { status: 'error', fieldErrors: { totpCode: t('backoffice.error.code') } };
  }
  let home: string;
  try {
    const session = await getAdminApi().verifyTotp(flow.challengeId, totpCode);
    await saveSession({ token: session.token, expiresAt: session.expiresAt });
    await clearSignInFlow();
    home = homeFor(session.operator.roles);
  } catch (error) {
    return errorState(error);
  }
  redirect(home);
}

export async function restartSignIn(): Promise<void> {
  await clearSignInFlow();
  redirect('/login');
}

export async function signOut(): Promise<void> {
  const session = await readSession();
  if (session) {
    try {
      await getAdminApi().signOut(session.token);
    } catch {
      // La sessione si chiude comunque nel browser; admin-api la fa scadere da sé.
    }
  }
  await clearSession();
  redirect('/login');
}
