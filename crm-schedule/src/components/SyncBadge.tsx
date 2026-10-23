// Значок общей базы рядом с «сохранено»: видно, что правки ушли на все устройства.
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useApp } from '../store';

export default function SyncBadge({ className = '' }: { className?: string }) {
  const { sync } = useApp();
  if (!sync.enabled) return null;

  if (sync.status === 'error') {
    return (
      <span
        className={`sync-badge error ${className}`.trim()}
        title={sync.error || 'Нет связи с общей базой'}
      >
        <CloudOff size={13} /> нет связи
      </span>
    );
  }

  if (sync.status === 'syncing') {
    return (
      <span className={`sync-badge busy ${className}`.trim()} title="Отправляем и забираем изменения">
        <RefreshCw size={13} /> синхронизация
      </span>
    );
  }

  const time = sync.lastSyncAt
    ? new Date(sync.lastSyncAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <span
      className={`sync-badge ${className}`.trim()}
      title={time ? `Общая база обновлена в ${time}` : 'Общая база включена'}
    >
      <Cloud size={13} /> {time ? `общая база ${time}` : 'общая база'}
    </span>
  );
}
