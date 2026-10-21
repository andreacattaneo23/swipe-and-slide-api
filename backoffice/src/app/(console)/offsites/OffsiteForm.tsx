'use client';

import { useActionState, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { Button, FormMessage, Note, Select, TextArea, TextInput } from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { formatDay, isoToRome } from '@/lib/time';
import { t } from '@/texts';
import type { City, Offsite } from '@/server/admin-api/types';
import { saveOffsite } from './actions';

export const OFFSITE_FORM_ID = 'offsite-form';

/** Valori iniziali del modulo da un offsite salvato, nell'ora di Roma. */
function initialValues(offsite?: Offsite): Record<string, string> {
  if (!offsite) return {};
  const start = isoToRome(offsite.startsAt);
  const end = isoToRome(offsite.endsAt);
  return {
    title: offsite.title,
    description: offsite.description,
    venueName: offsite.venueName,
    venueAddress: offsite.venueAddress,
    cityId: offsite.cityId,
    date: start.date,
    start: start.time,
    end: end.time,
    capacity: offsite.capacity === null ? '' : String(offsite.capacity),
  };
}

/**
 * Modulo dell'offsite (mockup 18d) con l'anteprima della card nell'app: nuovo offsite o modifica
 * di una bozza o di un offsite pubblicato, con la copertina caricata dal modulo.
 */
export function OffsiteForm({ cities, offsite }: { cities: City[]; offsite?: Offsite }) {
  const [state, action, pending] = useActionState(saveOffsite, initialFormState);
  const initial = state.values ?? initialValues(offsite);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const value = (name: string) => draft[name] ?? initial[name] ?? '';
  useEffect(
    () => () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    },
    [coverPreview],
  );
  const coverUrl = coverPreview ?? offsite?.coverUrl ?? null;
  const published = offsite?.status === 'published';
  const update = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLInputElement;
    if (target.name) setDraft((current) => ({ ...current, [target.name]: target.value }));
  };
  const city = cities.find((item) => item.id === value('cityId'))?.name ?? '';
  const when = [
    formatDay(value('date')),
    value('start') && value('end') ? `${value('start')}–${value('end')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="offsite">
      <form
        id={OFFSITE_FORM_ID}
        action={action}
        className="sheet offsite__form"
        noValidate
        onChange={update}
      >
        {offsite ? <input type="hidden" name="offsiteId" value={offsite.id} /> : null}
        <TextInput
          label={t('backoffice.offsiteForm.field.title')}
          name="title"
          required
          defaultValue={initial.title}
          error={state.fieldErrors?.title}
        />
        <TextArea
          label={t('backoffice.offsiteForm.field.description')}
          name="description"
          required
          rows={3}
          defaultValue={initial.description}
          error={state.fieldErrors?.description}
        />
        <div className="field">
          <p className="field__label">{t('backoffice.offsiteForm.field.cover')}</p>
          <div className="cover-row">
            <CoverImage url={coverUrl} small />
            <div className="cover-row__info">
              <label className="button button--outline cover-row__upload">
                <Icon name="upload" size={16} />
                <span>
                  {t(
                    coverUrl
                      ? 'backoffice.offsiteForm.replace'
                      : 'backoffice.offsiteForm.cover.choose',
                  )}
                </span>
                <input
                  type="file"
                  name="cover"
                  accept="image/jpeg,image/png,image/webp"
                  className="visually-hidden"
                  aria-describedby="cover-hint"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setCoverPreview(file ? URL.createObjectURL(file) : null);
                  }}
                />
              </label>
              <p className="note" id="cover-hint">
                {t('backoffice.offsiteForm.cover.hint')}
              </p>
              {state.fieldErrors?.cover ? (
                <p className="field__error">{state.fieldErrors.cover}</p>
              ) : null}
              <p className="note">
                <Icon name="info" size={15} />
                <span>{t('backoffice.offsiteForm.cover.note')}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="grid-2">
          <TextInput
            label={t('backoffice.offsiteForm.field.venue')}
            name="venueName"
            required
            defaultValue={initial.venueName}
            error={state.fieldErrors?.venueName}
          />
          <TextInput
            label={t('backoffice.offsiteForm.field.address')}
            name="venueAddress"
            required
            defaultValue={initial.venueAddress}
            error={state.fieldErrors?.venueAddress}
          />
        </div>
        <div className="grid-2">
          {cities.length > 0 ? (
            <Select
              label={t('backoffice.offsiteForm.field.city')}
              name="cityId"
              required
              defaultValue={initial.cityId ?? ''}
              error={state.fieldErrors?.cityId}
            >
              <option value="" />
              {cities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          ) : (
            <TextInput
              label={t('backoffice.offsiteForm.field.cityCode')}
              hint={t('backoffice.offsiteForm.field.cityCode.hint')}
              name="cityId"
              required
              inputMode="numeric"
              defaultValue={initial.cityId}
              error={state.fieldErrors?.cityId}
            />
          )}
          <TextInput
            label={t('backoffice.offsiteForm.field.date')}
            name="date"
            type="date"
            required
            defaultValue={initial.date}
            error={state.fieldErrors?.date}
          />
        </div>
        <div className="grid-3">
          <TextInput
            label={t('backoffice.offsiteForm.field.start')}
            name="start"
            type="time"
            required
            defaultValue={initial.start}
            error={state.fieldErrors?.start}
          />
          <TextInput
            label={t('backoffice.offsiteForm.field.end')}
            name="end"
            type="time"
            required
            defaultValue={initial.end}
            error={state.fieldErrors?.end}
          />
          <TextInput
            label={
              <>
                {t('backoffice.offsiteForm.field.capacity')}{' '}
                <span className="field__note">{t('common.optionalFeminine')}</span>
              </>
            }
            name="capacity"
            type="number"
            min={1}
            inputMode="numeric"
            defaultValue={initial.capacity}
            error={state.fieldErrors?.capacity}
          />
        </div>
        <Note icon="bell">{t('backoffice.offsiteForm.notice')}</Note>
        <Note icon="lock">{t('backoffice.offsiteForm.audit')}</Note>
        <FormMessage status={state.status} message={state.message} />
        <div className="offsite__buttons">
          {published ? (
            <Button type="submit" name="decision" value="save" icon="check" disabled={pending}>
              {t('backoffice.offsites.saveChanges')}
            </Button>
          ) : (
            <>
              <Button
                type="submit"
                name="decision"
                value="draft"
                variant="outline"
                disabled={pending}
              >
                {t('backoffice.offsiteForm.save')}
              </Button>
              <Button type="submit" name="decision" value="publish" icon="check" disabled={pending}>
                {t('backoffice.offsiteForm.publish')}
              </Button>
            </>
          )}
        </div>
      </form>
      <aside className="offsite__preview" aria-labelledby="offsite-preview-title">
        <h2 id="offsite-preview-title" className="label-caps">
          {t('backoffice.offsiteForm.preview')}
        </h2>
        <div className="offsite-card" aria-live="polite">
          <CoverImage url={coverUrl} />
          <div className="offsite-card__body">
            <p className="offsite-card__title">
              {value('title') || t('backoffice.offsiteForm.field.title')}
            </p>
            <p className="offsite-card__row">
              <Icon name="calendar" size={16} />
              <span>{when || t('backoffice.offsiteForm.field.date')}</span>
            </p>
            <p className="offsite-card__row">
              <Icon name="mapPin" size={16} />
              <span>
                {[value('venueName'), city].filter(Boolean).join(', ') ||
                  t('backoffice.offsiteForm.field.venue')}
              </span>
            </p>
            <p className="offsite-card__row">
              <Icon name="users" size={16} />
              <span>
                {offsite?.attendeesRounded
                  ? t('offsite.attendees.over', { count: offsite.attendeesRounded })
                  : t('offsite.under10')}
              </span>
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Copertina dell'offsite; senza immagine, il riquadro del brand. */
function CoverImage({ url, small = false }: { url: string | null; small?: boolean }) {
  const className = `cover${small ? ' cover--small' : ''}`;
  if (!url) return <span className={className} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- URL firmato o anteprima locale, da non ottimizzare
  return <img className={`${className} cover--image`} src={url} alt="" />;
}
