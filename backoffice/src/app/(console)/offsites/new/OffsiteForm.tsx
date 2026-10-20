'use client';

import { useActionState, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { Button, FormMessage, Note, Select, TextArea, TextInput } from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { formatDay } from '@/lib/time';
import { t } from '@/texts';
import type { City } from '@/server/admin-api/types';
import { saveOffsite } from './actions';

export const OFFSITE_FORM_ID = 'offsite-form';

/** Modulo del nuovo offsite (mockup 18d) con l'anteprima della card nell'app. */
export function OffsiteForm({ cities }: { cities: City[] }) {
  const [state, action, pending] = useActionState(saveOffsite, initialFormState);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (name: string) => draft[name] ?? state.values?.[name] ?? '';
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
        <TextInput
          label={t('backoffice.offsiteForm.field.title')}
          name="title"
          required
          defaultValue={state.values?.title}
          error={state.fieldErrors?.title}
        />
        <TextArea
          label={t('backoffice.offsiteForm.field.description')}
          name="description"
          required
          rows={3}
          defaultValue={state.values?.description}
          error={state.fieldErrors?.description}
        />
        <div className="field">
          <p className="field__label">{t('backoffice.offsiteForm.field.cover')}</p>
          <div className="cover-row">
            <span className="cover cover--small" aria-hidden="true" />
            <div className="cover-row__info">
              <p className="note">{t('backoffice.offsiteForm.cover.empty')}</p>
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
            defaultValue={state.values?.venueName}
            error={state.fieldErrors?.venueName}
          />
          <TextInput
            label={t('backoffice.offsiteForm.field.address')}
            name="venueAddress"
            required
            defaultValue={state.values?.venueAddress}
            error={state.fieldErrors?.venueAddress}
          />
        </div>
        <div className="grid-2">
          <Select
            label={t('backoffice.offsiteForm.field.city')}
            name="cityId"
            required
            defaultValue={state.values?.cityId ?? ''}
            error={state.fieldErrors?.cityId}
          >
            <option value="" />
            {cities.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
          <TextInput
            label={t('backoffice.offsiteForm.field.date')}
            name="date"
            type="date"
            required
            defaultValue={state.values?.date}
            error={state.fieldErrors?.date}
          />
        </div>
        <div className="grid-3">
          <TextInput
            label={t('backoffice.offsiteForm.field.start')}
            name="start"
            type="time"
            required
            defaultValue={state.values?.start}
            error={state.fieldErrors?.start}
          />
          <TextInput
            label={t('backoffice.offsiteForm.field.end')}
            name="end"
            type="time"
            required
            defaultValue={state.values?.end}
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
            defaultValue={state.values?.capacity}
            error={state.fieldErrors?.capacity}
          />
        </div>
        <Note icon="bell">{t('backoffice.offsiteForm.notice')}</Note>
        <Note icon="lock">{t('backoffice.offsiteForm.audit')}</Note>
        <FormMessage status={state.status} message={state.message} />
        <div className="offsite__buttons">
          <Button type="submit" name="decision" value="draft" variant="outline" disabled={pending}>
            {t('backoffice.offsiteForm.save')}
          </Button>
          <Button type="submit" name="decision" value="publish" icon="check" disabled={pending}>
            {t('backoffice.offsiteForm.publish')}
          </Button>
        </div>
      </form>
      <aside className="offsite__preview" aria-labelledby="offsite-preview-title">
        <h2 id="offsite-preview-title" className="label-caps">
          {t('backoffice.offsiteForm.preview')}
        </h2>
        <div className="offsite-card" aria-live="polite">
          <span className="cover" aria-hidden="true" />
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
              <span>{t('offsite.under10')}</span>
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
