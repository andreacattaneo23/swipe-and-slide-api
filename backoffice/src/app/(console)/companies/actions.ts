'use server';

/**
 * Gestori lato server delle aziende (D84, D85, D93, D94, D111, D120). Ogni azione passa da
 * admin-api con il token dell'operatore; motivazione obbligatoria (D91), conferma rafforzata con
 * nome esatto per la rimozione (D93, D244), anteprima con i soli conteggi per fusioni e spostamenti.
 */
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { getAdminApi, type ChangePreview, type RemovalPreview } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { explanationError, field, perform } from '@/server/perform';

const PATHS = ['/companies'];

export async function loadRemovalPreview(companyId: string): Promise<RemovalPreview | null> {
  const { token } = await requireOperator('companies');
  try {
    return await getAdminApi().getRemovalPreview(token, companyId);
  } catch {
    return null;
  }
}

/** Anteprima di una fusione o di uno spostamento: solo conteggi, nessuna persona. */
export async function loadChangePreview(
  kind: 'merge' | 'move',
  subject: string,
  targetCompanyId: string,
): Promise<ChangePreview | null> {
  const { token } = await requireOperator('companies');
  try {
    const api = getAdminApi();
    return kind === 'merge'
      ? await api.previewMerge(token, subject, targetCompanyId)
      : await api.previewDomainMove(token, subject, targetCompanyId);
  } catch {
    return null;
  }
}

export async function startRemovalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const companyId = field(formData, 'companyId');
  const expectedName = field(formData, 'expectedName');
  const explanation = field(formData, 'explanation');
  const confirmName = field(formData, 'confirmName');
  return perform(
    'companies',
    {
      values: { explanation, confirmName },
      errors: {
        explanation: explanationError(explanation),
        confirmName:
          confirmName.toLowerCase() !== expectedName.toLowerCase()
            ? t('backoffice.error.name')
            : undefined,
      },
      revalidate: PATHS,
    },
    async (api, token) => {
      await api.startRemoval(token, companyId, { explanation, confirmName });
      return 'backoffice.removal.started';
    },
  );
}

export async function cancelRemovalAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = field(formData, 'companyId');
  const explanation = field(formData, 'explanation');
  return perform(
    'companies',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: PATHS,
    },
    async (api, token) => {
      await api.cancelRemoval(token, companyId, { explanation });
      return 'backoffice.removal.cancelled';
    },
  );
}

export async function createCompanyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const name = field(formData, 'name', 120);
  const domainsText = field(formData, 'domains');
  const explanation = field(formData, 'explanation');
  const isDemo = formData.get('isDemo') === 'on';
  const domains = splitDomains(domainsText);
  return perform(
    'companies',
    {
      values: { name, domains: domainsText, explanation },
      errors: {
        name: name ? undefined : t('backoffice.error.required'),
        domains:
          domains.length > 0 && domains.length <= 20 ? undefined : t('backoffice.error.domain'),
        explanation: explanationError(explanation),
      },
      revalidate: PATHS,
    },
    async (api, token) => {
      await api.createCompany(token, { name, domains, isDemo, explanation });
      return 'backoffice.newCompany.created';
    },
  );
}

export async function renameCompanyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const companyId = field(formData, 'companyId');
  const name = field(formData, 'name', 120);
  const explanation = field(formData, 'explanation');
  return perform(
    'companies',
    {
      values: { name, explanation },
      errors: {
        name: name ? undefined : t('backoffice.error.required'),
        explanation: explanationError(explanation),
      },
      revalidate: [...PATHS, `/companies/${companyId}`],
    },
    async (api, token) => {
      await api.renameCompany(token, companyId, { name, explanation });
      return 'backoffice.company.renamed';
    },
  );
}

export async function addDomainAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const companyId = field(formData, 'companyId');
  const domain = field(formData, 'domain', 253).toLowerCase();
  const explanation = field(formData, 'explanation');
  return perform(
    'companies',
    {
      values: { domain, explanation },
      errors: {
        domain: domain.includes('.') ? undefined : t('backoffice.error.domain'),
        explanation: explanationError(explanation),
      },
      revalidate: [...PATHS, `/companies/${companyId}`],
    },
    async (api, token) => {
      await api.addDomain(token, companyId, { domain, explanation });
      return 'backoffice.company.domainAdded';
    },
  );
}

export async function removeDomainAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const companyId = field(formData, 'companyId');
  const domain = field(formData, 'domain', 253);
  const explanation = field(formData, 'explanation');
  return perform(
    'companies',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: [...PATHS, `/companies/${companyId}`],
    },
    async (api, token) => {
      await api.removeDomain(token, companyId, domain, { explanation });
      return 'backoffice.company.domainRemoved';
    },
  );
}

/** Fusione (P14) o spostamento di un dominio (D94), dopo l'anteprima. */
export async function changeCompanyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const kind = field(formData, 'kind') === 'move' ? 'move' : 'merge';
  const companyId = field(formData, 'companyId');
  const domain = field(formData, 'domain', 253);
  const targetCompanyId = field(formData, 'targetCompanyId');
  const explanation = field(formData, 'explanation');
  // Conferma rafforzata (D197, D244): nome dell'azienda assorbita o dominio spostato
  const expectedName = field(formData, 'expectedName', 253);
  const confirmName = field(formData, 'confirmName', 253);
  return perform(
    'companies',
    {
      values: { targetCompanyId, explanation, confirmName },
      errors: {
        targetCompanyId: targetCompanyId ? undefined : t('backoffice.error.target'),
        explanation: explanationError(explanation),
        confirmName:
          confirmName.toLowerCase() !== expectedName.toLowerCase()
            ? t('backoffice.error.name')
            : undefined,
      },
      revalidate: [...PATHS, `/companies/${companyId}`, `/companies/${targetCompanyId}`],
    },
    async (api, token) => {
      if (kind === 'merge') {
        await api.mergeCompany(token, companyId, {
          targetCompanyId,
          explanation,
          confirmName,
        });
        return 'backoffice.company.merged';
      }
      await api.moveDomain(token, domain, { targetCompanyId, explanation, confirmName });
      return 'backoffice.company.domainMoved';
    },
  );
}

function splitDomains(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
