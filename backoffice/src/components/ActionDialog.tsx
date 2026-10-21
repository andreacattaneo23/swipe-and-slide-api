'use client';

/**
 * Azione di un operatore in una finestra sopra la pagina (D123): motivazione obbligatoria (D91) e,
 * per le azioni distruttive, conferma rafforzata con il nome digitato e il codice del secondo
 * fattore (D93). La finestra raccoglie i campi e li manda al gestore lato server con una sola
 * chiamata; chiuderla non avvia nulla e i controlli che contano restano in admin-api.
 *
 * Le proprietà sono solo dati serializzabili (testi già risolti), perché il componente nasce dalle
 * pagine lato server.
 */
import { useActionState, useCallback, useEffect, useState, type ReactNode } from 'react';
import { initialFormState, type FormState } from '@/lib/form-state';
import { t } from '@/texts';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';
import { Button, FormMessage, Note, RequiredLabel, Select, TextArea, TextInput } from './ui';

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface ActionDialogProps {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  trigger: {
    label: string;
    variant?: 'primary' | 'outline' | 'destructive' | 'link';
    icon?: IconName;
  };
  title: string;
  /** Occhiello rosso delle azioni distruttive ("Azione distruttiva"). */
  eyebrow?: string;
  destructive?: boolean;
  /** Effetti dell'azione, in elenco come nella finestra della rimozione (18b). */
  effects?: string[];
  hidden?: Record<string, string>;
  /** Campi di testo semplici (nome, dominio). */
  inputs?: { name: string; label: string; defaultValue?: string; hint?: string }[];
  choice?: { name: string; label: string; options: ChoiceOption[]; placeholder?: string };
  number?: { name: string; label: string; min: number; max: number; defaultValue: number };
  /** Testo visibile all'utente (motivazione della sanzione o del rifiuto). */
  userText?: { label: string; hint?: string };
  /** Conferma rafforzata: nome o identificativo da digitare. */
  confirmName?: { label: string; expected: string };
  /** Senza motivazione: solo dove il contratto non la chiede. */
  noExplanation?: boolean;
  submitLabel: string;
  children?: ReactNode;
}

export function ActionDialog(props: ActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | undefined>();
  const close = useCallback(() => setOpen(false), []);
  return (
    <span className="action">
      <Button
        variant={props.trigger.variant ?? 'outline'}
        icon={props.trigger.icon}
        onClick={() => {
          setLastMessage(undefined);
          setOpen(true);
        }}
      >
        {props.trigger.label}
      </Button>
      {open ? (
        <ActionForm
          {...props}
          onClose={close}
          onDone={(message) => {
            setLastMessage(message);
            setOpen(false);
          }}
        />
      ) : null}
      {lastMessage ? (
        <span className="action__done" role="status">
          <Icon name="check" size={16} />
          {lastMessage}
        </span>
      ) : null}
    </span>
  );
}

function ActionForm({
  action,
  title,
  eyebrow,
  destructive,
  effects,
  hidden = {},
  inputs = [],
  choice,
  number,
  userText,
  confirmName,
  noExplanation,
  submitLabel,
  children,
  onClose,
  onDone,
}: ActionDialogProps & { onClose: () => void; onDone: (message?: string) => void }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [typedName, setTypedName] = useState('');

  // Con un risultato da leggere (email rivelata, codice) la finestra resta aperta.
  useEffect(() => {
    if (state.status === 'success' && !state.result?.length) onDone(state.message);
  }, [state, onDone]);

  const nameMatches =
    !confirmName || typedName.trim().toLowerCase() === confirmName.expected.trim().toLowerCase();
  const showResult = state.status === 'success' && !!state.result?.length;

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      eyebrow={eyebrow}
      eyebrowIcon={eyebrow ? 'trash' : undefined}
    >
      {children}
      {effects?.length ? (
        <ul className="effects">
          {effects.map((effect) => (
            <li key={effect}>
              <Icon name="info" />
              <span>{effect}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {showResult ? (
        <div className="dialog__form">
          <dl className="result">
            {state.result!.map((item) => (
              <div key={item.label}>
                <dt className="label-caps">{item.label}</dt>
                <dd className="result__value">{item.value}</dd>
              </div>
            ))}
          </dl>
          <FormMessage status="success" message={state.message} />
          <div className="dialog__buttons">
            <Button onClick={() => onDone(state.message)}>{t('common.close')}</Button>
          </div>
        </div>
      ) : (
        <form action={formAction} className="dialog__form" noValidate>
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {inputs.map((input) => (
            <TextInput
              key={input.name}
              label={input.label}
              hint={input.hint}
              name={input.name}
              required
              autoComplete="off"
              spellCheck={false}
              defaultValue={state.values?.[input.name] ?? input.defaultValue}
              error={state.fieldErrors?.[input.name]}
            />
          ))}
          {choice ? (
            <Select
              label={choice.label}
              name={choice.name}
              defaultValue={state.values?.[choice.name] ?? ''}
              error={state.fieldErrors?.[choice.name]}
            >
              {choice.placeholder ? <option value="">{choice.placeholder}</option> : null}
              {choice.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : null}
          {number ? (
            <TextInput
              label={number.label}
              name={number.name}
              type="number"
              inputMode="numeric"
              min={number.min}
              max={number.max}
              step={1}
              required
              defaultValue={state.values?.[number.name] ?? String(number.defaultValue)}
              error={state.fieldErrors?.[number.name]}
            />
          ) : null}
          {userText ? (
            <TextArea
              label={
                <RequiredLabel
                  label={userText.label}
                  note={t('backoffice.removalModal.required')}
                />
              }
              hint={userText.hint}
              name="userExplanation"
              required
              rows={3}
              maxLength={1000}
              defaultValue={state.values?.userExplanation}
              error={state.fieldErrors?.userExplanation}
            />
          ) : null}
          {noExplanation ? null : (
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
          )}
          {confirmName ? (
            <div className="dialog__row">
              {confirmName ? (
                <div className="confirm-name">
                  <TextInput
                    label={confirmName.label}
                    name="confirmName"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    value={typedName}
                    onChange={(event) => setTypedName(event.target.value)}
                    error={state.fieldErrors?.confirmName}
                  />
                  {typedName && nameMatches ? (
                    <Icon name="check" className="confirm-name__ok" />
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {noExplanation ? null : <Note icon="lock">{t('backoffice.removalModal.audit')}</Note>}
          <FormMessage status={state.status} message={state.message ?? state.fieldErrors?.form} />
          <div className="dialog__buttons">
            <Button variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'destructive' : 'primary'}
              disabled={pending || !nameMatches}
            >
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
