'use client';

/**
 * Fusione di un'azienda in un'altra (P14) o spostamento di un dominio (D94) in una finestra sopra
 * la pagina: si sceglie l'azienda di destinazione, si legge l'anteprima con i soli conteggi e
 * l'avviso di somiglianza dei nomi (architettura), poi si conferma con la motivazione (D91).
 */
import { useActionState, useEffect, useState, useTransition } from 'react';
import { Dialog } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import {
  Button,
  FormMessage,
  Note,
  RequiredLabel,
  Select,
  TextArea,
  TextInput,
} from '@/components/ui';
import { initialFormState } from '@/lib/form-state';
import { formatNumber } from '@/lib/time';
import { t } from '@/texts';
import type { ChangePreview } from '@/server/admin-api/types';
import { changeCompanyAction, loadChangePreview } from './actions';

export interface ChangeTarget {
  id: string;
  name: string;
}

export function ChangeDialogButton({
  kind,
  companyId,
  domain,
  targets,
  label,
  title,
  expectedName,
}: {
  kind: 'merge' | 'move';
  companyId: string;
  domain?: string;
  targets: ChangeTarget[];
  label: string;
  title: string;
  /** Testo da digitare per la conferma rafforzata: azienda assorbita o dominio (D197). */
  expectedName: string;
}) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [done, setDone] = useState<string | undefined>();
  return (
    <span className="action">
      <Button
        variant={kind === 'merge' ? 'outline' : 'link'}
        aria-haspopup="dialog"
        onClick={() => {
          setRound((value) => value + 1);
          setDone(undefined);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {open ? (
        <ChangeForm
          key={round}
          kind={kind}
          companyId={companyId}
          domain={domain}
          targets={targets}
          title={title}
          expectedName={expectedName}
          onClose={() => setOpen(false)}
          onDone={(message) => {
            setDone(message);
            setOpen(false);
          }}
        />
      ) : null}
      {done ? (
        <span className="action__done" role="status">
          <Icon name="check" size={16} />
          {done}
        </span>
      ) : null}
    </span>
  );
}

function ChangeForm({
  kind,
  companyId,
  domain,
  targets,
  title,
  expectedName,
  onClose,
  onDone,
}: {
  kind: 'merge' | 'move';
  companyId: string;
  domain?: string;
  targets: ChangeTarget[];
  title: string;
  expectedName: string;
  onClose: () => void;
  onDone: (message?: string) => void;
}) {
  const [state, action, pending] = useActionState(changeCompanyAction, initialFormState);
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [loading, startLoading] = useTransition();
  const [typedName, setTypedName] = useState(state.values?.confirmName ?? '');
  const nameMatches = typedName.trim().toLowerCase() === expectedName.toLowerCase();

  useEffect(() => {
    if (state.status === 'success') onDone(state.message);
  }, [state, onDone]);

  const choose = (value: string) => {
    setTarget(value);
    setPreview(null);
    if (!value) return;
    startLoading(async () =>
      setPreview(await loadChangePreview(kind, kind === 'merge' ? companyId : domain!, value)),
    );
  };

  return (
    <Dialog open onClose={onClose} title={title}>
      <form action={action} className="dialog__form" noValidate>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="expectedName" value={expectedName} />
        {domain ? <input type="hidden" name="domain" value={domain} /> : null}
        <Select
          label={t(kind === 'merge' ? 'backoffice.company.mergeInto' : 'backoffice.company.moveTo')}
          name="targetCompanyId"
          value={target}
          onChange={(event) => choose(event.target.value)}
          error={state.fieldErrors?.targetCompanyId}
        >
          <option value="">{t('backoffice.company.chooseTarget')}</option>
          {targets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        {target ? (
          <div className="removal-preview" aria-busy={loading} aria-live="polite">
            <p className="removal-preview__label">{t('backoffice.removalModal.preview')}</p>
            {preview ? (
              <ul className="preview-counts">
                <li>
                  {t('backoffice.preview.users', { count: formatNumber(preview.usersMoving) })}
                </li>
                <li>
                  {t('backoffice.preview.matches', {
                    count: formatNumber(preview.matchesToRevoke),
                  })}
                </li>
                <li>
                  {t('backoffice.preview.likes', { count: formatNumber(preview.likesToDelete) })}
                </li>
              </ul>
            ) : (
              <p className="removal-preview__value">{t('a11y.loading')}</p>
            )}
            {preview?.similarCompanies.length ? (
              <p className="preview-warning">
                <Icon name="alert" size={16} />
                <span>
                  {t('backoffice.preview.similar', { names: preview.similarCompanies.join(', ') })}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
        <Note icon="info">
          {t(kind === 'merge' ? 'backoffice.company.merge.note' : 'backoffice.company.move.note')}
        </Note>
        <TextArea
          label={
            <RequiredLabel
              label={t('backoffice.removalModal.explanation')}
              note={t('backoffice.removalModal.required')}
            />
          }
          hint={t('backoffice.explanation.hint')}
          name="explanation"
          required
          rows={2}
          maxLength={500}
          defaultValue={state.values?.explanation}
          error={state.fieldErrors?.explanation}
        />
        <div className="dialog__row">
          <TextInput
            label={t(
              kind === 'merge'
                ? 'backoffice.removalModal.name'
                : 'backoffice.company.move.confirmName',
            )}
            name="confirmName"
            required
            autoComplete="off"
            spellCheck={false}
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            error={state.fieldErrors?.confirmName}
          />
        </div>
        <Note icon="lock">{t('backoffice.removalModal.audit')}</Note>
        <FormMessage status={state.status} message={state.message} />
        <div className="dialog__buttons">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={pending || !preview || !nameMatches}>
            {t(
              kind === 'merge'
                ? 'backoffice.company.merge.confirm'
                : 'backoffice.company.move.confirm',
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
