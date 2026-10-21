'use server';

/**
 * Gestori lato server dell'accesso dell'operatore (D88, D231, D238): email, poi codice all'email
 * ricevuto, senza secondo fattore (D244).
 * Il browser parla solo con il server Next; il token della sessione resta nel cookie cifrato.
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { homeFor } from '@/lib/roles';
import { t } from '@/texts';
import { maskEmail } from '@/lib/mask-email';
import { AdminApiError, getAdminApi } from '@/server/admin-api';
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
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return {
      status: 'error',
      fieldErrors: { email: t('backoffice.error.required') },
      values: { email },
    };
  }
  try {
    await getAdminApi().requestSignInCode(email);
    await saveSignInFlow({ email, maskedEmail: maskEmail(email) });
  } catch (error) {
    return errorState(error, { email });
  }
  redirect('/login');
}

/** Verifica del codice all'email, come `POST /backoffice/auth/verify` (D244). */
export async function verifySignIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const flow = await readSignInFlow();
  if (!flow) return { status: 'error', message: t('backoffice.signIn.expired') };
  const code = normalizeCode(formData.get('code'));
  if (!CODE_PATTERN.test(code)) {
    return { status: 'error', fieldErrors: { code: t('backoffice.error.code') } };
  }
  let home: string;
  try {
    const api = getAdminApi();
    const session = await api.verifySignIn(flow.email, code);
    const operator = await api.getCurrentOperator(session.token);
    await saveSession({ token: session.token, expiresAt: session.expiresAt });
    await clearSignInFlow();
    home = homeFor(operator.roles);
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'code_expired') await clearSignInFlow();
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
