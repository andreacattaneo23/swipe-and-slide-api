'use server';

/**
 * Configurazione (D89): limiti e voci delle tassonomie a tema, ogni modifica con la motivazione e
 * una riga d'audit. Cambiare un valore deciso resta una decisione di prodotto (architettura).
 */
import type { FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { TAXONOMIES, type TaxonomyId } from '@/server/admin-api';
import { explanationError, field, perform } from '@/server/perform';

export async function updateLimitAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const key = field(formData, 'key', 80);
  const raw = field(formData, 'value', 12);
  const value = Number(raw);
  const explanation = field(formData, 'explanation');
  return perform(
    'config',
    {
      values: { value: raw, explanation },
      errors: {
        value: raw && Number.isInteger(value) ? undefined : t('backoffice.error.range'),
        explanation: explanationError(explanation),
      },
      revalidate: ['/config'],
    },
    async (api, token) => {
      await api.updateLimit(token, key, { value, explanation });
      return 'common.saved';
    },
  );
}

export async function setTaxonomyItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const taxonomy = field(formData, 'taxonomy') as TaxonomyId;
  const key = field(formData, 'key', 80);
  const active = field(formData, 'active') === 'true';
  const explanation = field(formData, 'explanation');
  return perform(
    'config',
    {
      values: { explanation },
      errors: {
        form: TAXONOMIES.includes(taxonomy) ? undefined : t('backoffice.error.required'),
        explanation: explanationError(explanation),
      },
      revalidate: ['/config'],
    },
    async (api, token) => {
      await api.setTaxonomyItem(token, taxonomy, key, { active, explanation });
      return 'common.saved';
    },
  );
}
