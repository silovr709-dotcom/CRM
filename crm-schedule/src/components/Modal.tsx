// Всплывающее окно: закрывается по Esc, клику по фону и крестику.
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function Modal(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [props.onClose]);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className={`modal modal-${props.size ?? 'md'}`} role="dialog" aria-modal="true" aria-label={typeof props.title === 'string' ? props.title : 'Карточка'}>
        <header className="modal-head">
          <div className="modal-head-text">
            <h2>{props.title}</h2>
            {props.subtitle && <div className="modal-subtitle">{props.subtitle}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Закрыть">✕</button>
        </header>
        <div className="modal-body">{props.children}</div>
        {props.footer && <footer className="modal-foot">{props.footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
