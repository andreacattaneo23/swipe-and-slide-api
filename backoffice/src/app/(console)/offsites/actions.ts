'use server';

/**
 * Gestori lato server degli offsite (D150, D153, D167, D197): bozza, modifica, pubblicazione,
 * annullamento con l'avviso agli iscritti e copertina. Creazione, modifiche, pubblicazione e
 * annullamento restano nell'audit di admin-api; nessun elenco degli iscritti, solo il numero
 * arrotondato. Il modulo non chiede la motivazione (D238); l'annullamento sì, perché avvisa gli
 * iscritti ([Proposta]).
 */
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { romeToIso } from '@/lib/time';
import { t } from '@/texts';
import { getAdminApi, type CoverUpload } from '@/server/admin-api';
import { requireOperator } from '@/server/auth';
import { errorState } from '@/server/form-errors';
import { explanationError, field, perform } from '@/server/perform';

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
const REQUIRED = [
  'title',
  'description',
  'venueName',
  'venueAddress',
  'cityId',
  'date',
  'start',
  'end',
] as const;
const MAX_LENGTH: Partial<Record<(typeof FIELDS)[number], number>> = {
  title: 120,
  description: 4000,
  venueName: 120,
  venueAddress: 240,
};

const COVER_MAX_BYTES = 5 * 1024 * 1024;

export async function saveOffsite(_prev: FormState, formData: FormData): Promise<FormState> {
  const { token } = await requireOperator('offsites');
  const offsiteId = field(formData, 'offsiteId');
  const values = Object.fromEntries(
    FIELDS.map((name) => [name, field(formData, name, MAX_LENGTH[name] ?? 100)]),
  ) as Record<(typeof FIELDS)[number], string>;
  const publish = formData.get('decision') === 'publish';

  const fieldErrors: Record<string, string> = {};
  for (const name of REQUIRED) {
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
  const cover = await readCover(formData.get('cover'));
  if (cover === 'invalid') fieldErrors.cover = t('backoffice.error.cover');
  if (Object.keys(fieldErrors).length > 0) return { status: 'error', fieldErrors, values };

  let id = offsiteId;
  try {
    const api = getAdminApi();
    const input = {
      title: values.title,
      description: values.description,
      venueName: values.venueName,
      venueAddress: values.venueAddress,
      cityId: values.cityId,
      startsAt: startsAt!,
      endsAt: endsAt!,
      capacity,
    };
    const saved = offsiteId
      ? await api.updateOffsite(token, offsiteId, input)
      : await api.createOffsite(token, input);
    id = saved.id;
    if (cover && cover !== 'invalid') await api.uploadCover(token, saved.id, cover);
    if (publish && saved.status === 'draft') await api.publishOffsite(token, saved.id);
  } catch (error) {
    return errorState(error, values);
  }
  const done = publish ? 'published' : offsiteId ? 'saved' : 'draft';
  redirect(`/offsites/${encodeURIComponent(id)}?done=${done}`);
}

export async function cancelOffsiteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const offsiteId = field(formData, 'offsiteId');
  const explanation = field(formData, 'explanation');
  return perform(
    'offsites',
    {
      values: { explanation },
      errors: { explanation: explanationError(explanation) },
      revalidate: ['/offsites', `/offsites/${offsiteId}`],
    },
    async (api, token) => {
      await api.cancelOffsite(token, offsiteId, { explanation });
      return 'backoffice.offsites.cancelled';
    },
  );
}

/**
 * Copertina caricata dal modulo: solo JPEG, PNG o WebP fino a 5 MB, riconosciuti dai primi byte e
 * non dal nome del file. Nessun file vuoto: senza scelta la copertina resta com'è.
 */
async function readCover(
  value: FormDataEntryValue | null,
): Promise<CoverUpload | null | 'invalid'> {
  if (!value || typeof value === 'string' || value.size === 0) return null;
  if (value.size > COVER_MAX_BYTES) return 'invalid';
  const bytes = new Uint8Array(await value.arrayBuffer());
  const contentType = sniffImage(bytes);
  if (!contentType) return 'invalid';
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
  return { fileName: `cover.${extension}`, contentType, bytes };
}

function sniffImage(bytes: Uint8Array): CoverUpload['contentType'] | null {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
