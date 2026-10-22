// Небольшие уведомления внизу экрана: сохранено, импортировано, ошибка.
import { useApp } from '../store';

export default function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast toast-${toast.kind}`} onClick={() => dismissToast(toast.id)}>
          <span className="toast-icon">{toast.kind === 'error' ? '!' : toast.kind === 'info' ? 'i' : '✓'}</span>
          <span>{toast.text}</span>
        </button>
      ))}
    </div>
  );
}
