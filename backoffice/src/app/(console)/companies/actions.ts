'use server';

/**
 * Gestori lato server delle aziende (D84, D85, D93, D111, D120). Ogni azione passa da admin-api
 * con il token dell'operatore; motivazione obbligatoria (D91), conferma rafforzata con nome e
 * TOTP per la rimozione (D93). Il backoffice controlla i campi per dare subito l'errore, ma la
 * verifica che conta è quella di admin-api.
 */
import { revalidatePath } from 'next/cache';
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { getAdminApi, type RemovalPreview } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { errorState } from '@/server/form-errors';

const field = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

export async function loadRemovalPreview(companyId: string): Promise<RemovalPreview | null> {
  const { token } = await requireOperator('companies');
  try {
    return await getAdminApi().getRemovalPreview(token, companyId);
  } catch {
    return null;
  }
}

export async function startRemovalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireOperator('companies');
  const companyId = field(formData, 'companyId');
  const expectedName = field(formData, 'expectedName');
  const explanation = field(formData, 'explanation');
  const confirmName = field(formData, 'confirmName');
  const totpCode = field(formData, 'totpCode').replace(/\s/g, '');
  const values = { explanation, confirmName };

  const fieldErrors: Record<string, string> = {};
  if (!explanation) fieldErrors.explanation = t('backoffice.error.explanation');
  if (confirmName !== expectedName) fieldErrors.confirmName = t('backoffice.error.name');
  if (!/^\d{6}$/.test(totpCode)) fieldErrors.totpCode = t('backoffice.error.code');
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', fieldErrors, values };

  try {
    await getAdminApi().startRemoval(token, companyId, { explanation, confirmName, totpCode });
  } catch (error) {
    return errorState(error, values);
  }
  revalidatePath('/companies');
  return { status: 'success', message: t('backoffice.removal.started') };
}

export async function cancelRemovalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { token } = await requireOperator('companies');
  const companyId = field(formData, 'companyId');
  const explanation = field(formData, 'explanation');
  if (!explanation) {
    return { status: 'error', fieldErrors: { explanation: t('backoffice.error.explanation') } };
  }
  try {
    await getAdminApi().cancelRemoval(token, companyId, { explanation });
  } catch (error) {
    return errorState(error, { explanation });
  }
  revalidatePath('/companies');
  return { status: 'success', message: t('backoffice.removal.cancelled') };
}

export async function createCompanyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { token } = await requireOperator('companies');
  const name = field(formData, 'name');
  const domainsText = field(formData, 'domains');
  const explanation = field(formData, 'explanation');
  const values = { name, domains: domainsText, explanation };
  const domains = domainsText
    .split(/[\s,;]+/)
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = t('backoffice.error.required');
  if (domains.length === 0) fieldErrors.domains = t('backoffice.error.domain');
  if (!explanation) fieldErrors.explanation = t('backoffice.error.explanation');
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', fieldErrors, values };

  try {
    await getAdminApi().createCompany(token, { name, domains, explanation });
  } catch (error) {
    return errorState(error, values);
  }
  revalidatePath('/companies');
  return { status: 'success', message: t('backoffice.newCompany.created') };
}
