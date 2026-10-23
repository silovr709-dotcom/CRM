// Всплывающее окно: фокус внутри, возврат фокуса, Esc и клик по фону.
// На телефоне — «шторка» снизу.
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Окна могут открываться друг из друга (задача поверх карточки клиента).
// Стек нужен, чтобы Esc и Tab слушалось только верхнее окно, а фон не разблокировался раньше времени.
const modalStack: string[] = [];
let bodyOverflow = '';

function isTopModal(id: string): boolean {
  return modalStack[modalStack.length - 1] === id;
}

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
  const modalId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  // Колбэк закрытия держим в ref: в карточках он создаётся на каждый рендер и,
  // попадая в зависимости эффекта, заставлял его перезапускаться на любую букву —
  // фокус прыгал обратно в первое поле.
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  // Стек открытых окон: фон блокируем один раз, снимаем — когда закрылось последнее.
  useEffect(() => {
    modalStack.push(modalId);
    if (modalStack.length === 1) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      const index = modalStack.indexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
      if (modalStack.length === 0) document.body.style.overflow = bodyOverflow;
    };
  }, [modalId]);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      // Слушаем только верхнее окно: иначе Esc закрывал бы и родительскую карточку.
      if (!isTopModal(modalId)) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
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

    // Первое поле (или кнопка) внутри — фокус сразу туда, но только если человек
    // ещё не успел ткнуть в другое поле сам.
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const active = document.activeElement;
      if (active && panel.contains(active) && active !== panel) return;
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus]')
        ?? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).find((element) => element.offsetParent !== null);
      preferred?.focus();
    }, 30);

    // Возврат фокуса — только при закрытии окна, а не при каждом рендере.
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
      const target = previousFocus.current;
      if (target && document.contains(target)) target.focus?.();
    };
  }, [modalId]);

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!isTopModal(modalId)) return;
        onCloseRef.current();
      }}
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
