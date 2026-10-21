'use client';

import { useActionState, useEffect, useState } from 'react';
import { Dialog } from '@/components/Dialog';
import {
  Button,
  Checkbox,
  FormMessage,
  Note,
  RequiredLabel,
  TextArea,
  TextInput,
} from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { t } from '@/texts';
import { createCompanyAction } from './actions';

/**
 * "Nuova azienda" (mockup 18a): solo il nome e i domini, nessun logo (D23, D35); il tipo
 * dimostrativo si sceglie alla creazione e non cambia più (D42).
 */
export function NewCompanyButton() {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  return (
    <>
      <Button
        icon="plus"
        aria-haspopup="dialog"
        onClick={() => {
          setRound((value) => value + 1);
          setOpen(true);
        }}
      >
        {t('backoffice.new')}
      </Button>
      <NewCompanyDialog key={round} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NewCompanyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(createCompanyAction, initialFormState);
  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);
  return (
    <Dialog open={open} onClose={onClose} title={t('backoffice.newCompany.title')}>
      <form action={action} className="dialog__form" noValidate>
        <TextInput
          label={t('backoffice.column.company')}
          name="name"
          required
          autoComplete="off"
          defaultValue={state.values?.name}
          error={state.fieldErrors?.name}
        />
        <TextArea
          label={t('backoffice.column.domains')}
          hint={t('backoffice.newCompany.domains.hint')}
          name="domains"
          required
          rows={3}
          spellCheck={false}
          defaultValue={state.values?.domains}
          error={state.fieldErrors?.domains}
        />
        <Checkbox
          label={t('backoffice.newCompany.demo')}
          hint={t('backoffice.newCompany.demo.hint')}
          name="isDemo"
        />
        <TextArea
          label={
            <RequiredLabel
              label={t('backoffice.removalModal.explanation')}
              note={t('backoffice.removalModal.required')}
            />
          }
          name="explanation"
          required
          rows={2}
          defaultValue={state.values?.explanation}
          error={state.fieldErrors?.explanation}
        />
        <Note icon="info">{t('backoffice.removalModal.audit')}</Note>
        <FormMessage status={state.status} message={state.message} />
        <div className="dialog__buttons">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending}>
            {t('backoffice.newCompany.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
