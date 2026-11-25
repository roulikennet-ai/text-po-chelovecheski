/* ============================================================================
   Modal.tsx — модальные окна M1–M5 (design.md §5.10).
   ========================================================================== */

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Иконка слева от заголовка. */
  icon?: ReactNode;
  tone?: 'neutral' | 'warn' | 'bad';
  /** Без шапки и отступов тела — контент сам управляет вёрсткой (плитки выбора). */
  bare?: boolean;
}

export function Modal({ open, title, onClose, children, footer, width = 560, icon, tone = 'neutral', bare = false }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && dialog) {
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        style={{ maxWidth: width }}
      >
        {bare ? (
          <>{children}</>
        ) : (
          <>
            <div className="modal__head">
              <div className="modal__title-row">
                {icon && <span className={`modal__icon modal__icon--${tone}`}>{icon}</span>}
                <h2 className="modal__title" id="modal-title">
                  {title}
                </h2>
              </div>
              <IconButton label="Закрыть" onClick={onClose}>
                <X size={18} />
              </IconButton>
            </div>

            <div className="modal__body">{children}</div>

            {footer && <div className="modal__footer">{footer}</div>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
