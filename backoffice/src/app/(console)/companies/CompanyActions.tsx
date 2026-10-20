'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Dialog } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { Button, FormMessage, Note, RequiredLabel, TextArea, TextInput } from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { t } from '@/texts';
import type { RemovalPreview } from '@/server/admin-api/types';
import { cancelRemovalAction, loadRemovalPreview, startRemovalAction } from './actions';

/** Azioni di una riga dell'elenco: rimozione con conferma rafforzata o suo annullamento. */
export function CompanyActions({
  companyId,
  name,
  removing,
}: {
  companyId: string;
  name: string;
  removing: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Una chiave nuova a ogni apertura: il modulo riparte vuoto, senza l'esito della volta prima.
  const [round, setRound] = useState(0);
  const show = () => {
    setRound((value) => value + 1);
    setOpen(true);
  };
  return (
    <div className="row-actions">
      {removing ? (
        <button type="button" className="row-actions__item" onClick={show}>
          {t('backoffice.removal.cancel')}
        </button>
      ) : (
        <button
          type="button"
          className="row-actions__item row-actions__item--danger"
          aria-haspopup="dialog"
          onClick={show}
        >
          {t('backoffice.remove')}
          <span className="visually-hidden"> {name}</span>
        </button>
      )}
      {removing ? (
        <CancelRemovalDialog
          key={round}
          open={open}
          onClose={() => setOpen(false)}
          companyId={companyId}
          name={name}
        />
      ) : (
        <RemovalDialog
          key={round}
          open={open}
          onClose={() => setOpen(false)}
          companyId={companyId}
          name={name}
        />
      )}
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  name: string;
}

/** Finestra di rimozione (mockup 18b): anteprima, effetti, motivazione, nome e TOTP (D93, D111). */
export function RemovalDialog({ open, onClose, companyId, name }: DialogProps) {
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [loading, startLoading] = useTransition();
  const [typedName, setTypedName] = useState('');
  const [state, action, pending] = useActionState(startRemovalAction, initialFormState);

  useEffect(() => {
    if (!open) return;
    startLoading(async () => setPreview(await loadRemovalPreview(companyId)));
  }, [open, companyId]);

  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);

  const nameMatches = typedName.trim() === name;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow={t('backoffice.removalModal.eyebrow')}
      eyebrowIcon="trash"
      title={t('backoffice.removalModal.title.value', { name })}
    >
      <div className="removal-preview" aria-busy={loading}>
        <p className="removal-preview__label">{t('backoffice.removalModal.preview')}</p>
        {preview ? (
          <>
            <p className="removal-preview__value">
              {preview.accountsCount < 10
                ? t('backoffice.removalModal.accounts.under10')
                : t('backoffice.removalModal.accounts.value', { count: preview.accountsCount })}
            </p>
            <p className="removal-preview__domains">{preview.domains.join(' · ')}</p>
          </>
        ) : (
          <p className="removal-preview__value">{t('a11y.loading')}</p>
        )}
      </div>
      <ul className="effects">
        <li>
          <Icon name="lock" />
          <span>{t('backoffice.removalModal.p1')}</span>
        </li>
        <li>
          <Icon name="info" />
          <span>{t('backoffice.removalModal.p2')}</span>
        </li>
        <li>
          <Icon name="clock" />
          <span>{t('backoffice.removalModal.p3')}</span>
        </li>
        <li>
          <Icon name="lock" />
          <span>{t('backoffice.removalModal.p4')}</span>
        </li>
      </ul>
      <form action={action} className="dialog__form" noValidate>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="expectedName" value={name} />
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
        <div className="dialog__row">
          <div className="confirm-name">
            <TextInput
              label={t('backoffice.removalModal.name')}
              name="confirmName"
              required
              autoComplete="off"
              spellCheck={false}
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              error={state.fieldErrors?.confirmName}
            />
            {nameMatches ? <Icon name="check" className="confirm-name__ok" /> : null}
          </div>
          <TextInput
            label={t('backoffice.removalModal.code')}
            name="totpCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            required
            className="field--code"
            error={state.fieldErrors?.totpCode}
          />
        </div>
        <Note icon="info">{t('backoffice.removalModal.audit')}</Note>
        <FormMessage status={state.status} message={state.message} />
        <div className="dialog__buttons">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="destructive" disabled={pending || !nameMatches}>
            {t('backoffice.removalModal.confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Annullamento della rimozione durante l'intervallo, con motivazione (D91, D120). */
function CancelRemovalDialog({ open, onClose, companyId, name }: DialogProps) {
  const [state, action, pending] = useActionState(cancelRemovalAction, initialFormState);
  useEffect(() => {
    if (state.status === 'success') onClose();
  }, [state, onClose]);
  return (
    <Dialog open={open} onClose={onClose} title={`${t('backoffice.removal.cancel')} · ${name}`}>
      <form action={action} className="dialog__form" noValidate>
        <input type="hidden" name="companyId" value={companyId} />
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
            {t('backoffice.removal.cancel')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
