// Индикатор сохранения: виден и на телефоне, где боковой панели нет.
import { useEffect, useState } from 'react';
import { Check, CloudOff } from 'lucide-react';
import { useApp } from '../store';

export default function SavedBadge({ className = '' }: { className?: string }) {
  const { savedAt, storageOk } = useApp();
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    setFresh(true);
    const timer = window.setTimeout(() => setFresh(false), 1200);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  if (!storageOk) {
    return (
      <span className={`saved-badge error ${className}`} title="Браузер не даёт сохранить данные — скачайте копию в «Данных»">
        <CloudOff size={13} /> не сохраняется
      </span>
    );
  }

  const time = savedAt ? new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <span className={`saved-badge${fresh ? ' fresh' : ''} ${className}`} title={savedAt ? `Сохранено в ${time}` : 'Сохранено'}>
      <Check size={13} /> {fresh ? 'сохранено' : `сохранено ${time}`}
    </span>
  );
}
