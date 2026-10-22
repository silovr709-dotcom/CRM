// Всплывающее окно: фокус внутри, возврат фокуса, Esc и клик по фону.
// На телефоне — «шторка» снизу.
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  headExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  /** Не растягивать на весь экран на телефоне. */
  compact?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Первый инпут или кнопка внутри — фокус сразу туда.
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus]')
        ?? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).find((element) => element.offsetParent !== null);
      preferred?.focus();
    }, 30);

    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus?.();
    };
  }, [props.onClose]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <div
        ref={panelRef}
        className={`modal modal-${props.size ?? 'md'}${props.compact ? ' modal-compact' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-head">
          <div className="modal-head-text">
            <h2 id={titleId}>{props.title}</h2>
            {props.subtitle && <div className="modal-subtitle">{props.subtitle}</div>}
          </div>
          <div className="modal-head-actions">
            {props.headExtra}
            <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer && <footer className="modal-foot">{props.footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
