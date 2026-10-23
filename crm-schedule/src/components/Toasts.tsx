// Уведомления внизу экрана. У опасных действий есть кнопка «Вернуть».
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useApp } from '../store';

export default function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon" aria-hidden="true">
            {toast.kind === 'error' ? <TriangleAlert size={13} /> : toast.kind === 'info' ? <Info size={13} /> : <Check size={13} />}
          </span>
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => { toast.action?.run(); dismissToast(toast.id); }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Закрыть">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
