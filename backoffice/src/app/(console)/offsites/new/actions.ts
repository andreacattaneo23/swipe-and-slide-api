'use server';

/**
 * Gestore lato server del nuovo offsite (D150): bozza o pubblicazione. Creazione, modifiche,
 * pubblicazione e annullamento restano nell'audit di admin-api. Nessun elenco degli iscritti, solo
 * il numero arrotondato (D153, D167).
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { romeToIso } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { errorState } from '@/server/form-errors';

const FIELDS = [
  'title',
  'description',
  'venueName',
  'venueAddress',
  'cityId',
  'date',
  'start',
  'end',
  'capacity',
] as const;

export async function saveOffsite(_prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireOperator('offsites');
  const values = Object.fromEntries(
    FIELDS.map((name) => [name, String(formData.get(name) ?? '').trim()]),
  ) as Record<(typeof FIELDS)[number], string>;
  const publish = formData.get('decision') === 'publish';

  const fieldErrors: Record<string, string> = {};
  for (const name of [
    'title',
    'description',
    'venueName',
    'venueAddress',
    'cityId',
    'date',
    'start',
    'end',
  ] as const) {
    if (!values[name]) fieldErrors[name] = t('backoffice.error.required');
  }
  const startsAt = romeToIso(values.date, values.start);
  const endsAt = romeToIso(values.date, values.end);
  if (values.date && values.start && values.end && (!startsAt || !endsAt || endsAt <= startsAt)) {
    fieldErrors.end = t('backoffice.offsiteForm.error.dates');
  }
  const capacity = values.capacity ? Number(values.capacity) : null;
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    fieldErrors.capacity = t('backoffice.error.required');
  }
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', fieldErrors, values };

  try {
    const api = getAdminApi();
    const offsite = await api.createOffsite(token, {
      title: values.title,
      description: values.description,
      venueName: values.venueName,
      venueAddress: values.venueAddress,
      cityId: values.cityId,
      startsAt: startsAt!,
      endsAt: endsAt!,
      capacity,
    });
    if (publish) await api.publishOffsite(token, offsite.id);
  } catch (error) {
    return errorState(error, values);
  }
  redirect(`/offsites/new?done=${publish ? 'published' : 'draft'}`);
}
