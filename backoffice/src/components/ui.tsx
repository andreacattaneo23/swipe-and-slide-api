'use client';

/**
 * Insieme di componenti semplice del backoffice (D92): non il design system dell'app, solo
 * elementi HTML nativi con colori e font del brand. Accessibilità WCAG 2.2 AA (D198): etichette
 * collegate, errori annunciati, focus visibile, aree di almeno 44 px.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'outline' | 'destructive' | 'link';

export function Button({
  variant = 'primary',
  icon,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: IconName }) {
  return (
    <button
      type="button"
      {...props}
      className={['button', `button--${variant}`, className].filter(Boolean).join(' ')}
    >
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Etichetta, suggerimento ed errore collegati al controllo con id e aria-describedby. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  hint,
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          className="control"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...props}
        />
      )}
    </Field>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          className="control control--area"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...props}
        />
      )}
    </Field>
  );
}

export function Select({
  label,
  hint,
  error,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="select">
          <select
            id={id}
            className="control"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            {...props}
          >
            {children}
          </select>
          <Icon name="chevronDown" className="select__icon" />
        </div>
      )}
    </Field>
  );
}

/** Casella di spunta con l'etichetta accanto e un suggerimento facoltativo. */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={['checkbox', className].filter(Boolean).join(' ')}>
      <input id={id} type="checkbox" aria-describedby={hintId} {...props} />
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Etichetta di un campo obbligatorio come nei mockup: "Motivazione obbligatoria". */
export function RequiredLabel({ label, note }: { label: string; note: string }) {
  return (
    <>
      <b>{label}</b> <span className="field__note">{note}</span>
    </>
  );
}

export function Note({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <p className="note">
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </p>
  );
}

/** Messaggio del modulo, annunciato dai lettori di schermo. */
export function FormMessage({
  status,
  message,
}: {
  status: 'idle' | 'error' | 'success';
  message?: string | undefined;
}) {
  if (!message || status === 'idle') return null;
  return (
    <p
      className={`form-message form-message--${status}`}
      role={status === 'error' ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}
