'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Finestra sopra la pagina (D123) con l'elemento <dialog> nativo: focus intrappolato, contenuto
 * sotto inerte, chiusura con Esc. Il velo è lo pseudo-elemento ::backdrop.
 */
export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  eyebrowIcon,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  eyebrowIcon?: IconName;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      {open ? (
        <>
          {eyebrow ? (
            <p className="dialog__eyebrow">
              {eyebrowIcon ? <Icon name={eyebrowIcon} /> : null}
              <span>{eyebrow}</span>
            </p>
          ) : null}
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
          {children}
        </>
      ) : null}
    </dialog>
  );
}
