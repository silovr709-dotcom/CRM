// Общая база: один и тот же список клиентов и сделок на телефоне и компьютере.
// Здесь код доступа, ссылка для второго устройства и состояние обмена.
import { useEffect, useRef, useState } from 'react';
import {
  Check, Cloud, Copy, History, Link2, RefreshCw, RotateCcw, Unplug,
} from 'lucide-react';
import { useApp } from '../store';
import { formatSyncCode, makeSyncCode, MIN_CODE_LENGTH, normalizeSyncCode } from '../lib/sync';
import { absoluteLink, navigate, useRoute } from '../lib/router';
import { fmtDateTime } from '../lib/dates';
import { fmtBytes } from '../lib/attachments';
import type { SpaceVersion } from '../lib/sync';
import Modal from './Modal';

export default function SyncCard() {
  const {
    sync, enableSync, disableSync, syncNow, notify, loadVersions, restoreVersion,
  } = useApp();
  const route = useRoute();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState('');
  const [versions, setVersions] = useState<SpaceVersion[] | null>(null);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [versionsError, setVersionsError] = useState('');
  const [restore, setRestore] = useState<SpaceVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const handled = useRef('');

  // Ссылка вида #/sync/КОД: пришла с другого устройства — предлагаем подключиться.
  useEffect(() => {
    if (!route.sync || sync.enabled) return;
    const code = normalizeSyncCode(route.sync);
    if (code.length < MIN_CODE_LENGTH || handled.current === code) return;
    handled.current = code;
    setInvite(code);
  }, [route.sync, sync.enabled]);

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      notify(`Скопируйте вручную: ${text}`, 'info');
    }
  };

  const join = async (code: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await enableSync(code, { create: false });
    setBusy(false);
    if (ok) {
      setInvite('');
      setInput('');
      if (route.sync) navigate({ view: 'data' });
    }
  };

  const showVersions = async () => {
    setVersionsBusy(true);
    setVersionsError('');
    const list = await loadVersions();
    setVersions(list);
    setVersionsBusy(false);
    if (!list.length) setVersionsError('Сервер пока не помнит прошлых версий — они появятся после первых синхронизаций');
  };

  const confirmRestore = async () => {
    if (!restore || restoring) return;
    setRestoring(true);
    const ok = await restoreVersion(restore.revision);
    setRestoring(false);
    if (ok) {
      setRestore(null);
      setVersions(null);
    }
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    await enableSync(makeSyncCode(), { create: true });
    setBusy(false);
  };

  const time = sync.lastSyncAt
    ? new Date(sync.lastSyncAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';

  const state = (() => {
    if (sync.status === 'syncing') return 'Синхронизация…';
    if (sync.status === 'error') {
      return `Синхронизация не прошла: ${sync.error.toLowerCase()}. Правки сохранены здесь и уйдут, когда связь вернётся.`;
    }
    if (!time) return 'Общая база включена, ждём первый обмен';
    return sync.serverDevice
      ? `Синхронизировано в ${time}. Последнее изменение — с ${sync.serverDevice}`
      : `Синхронизировано в ${time}`;
  })();

  return (
    <section className="card" id="sync">
      <div className="section-head">
        <div>
          <h2><Cloud size={16} /> Общая база</h2>
          <span className="muted">одни клиенты и сделки на телефоне и компьютере</span>
        </div>
        {sync.enabled && (
          <span className={`sync-chip${sync.status === 'error' ? ' error' : ''}`}>
            {sync.status === 'error' ? 'нет связи' : 'включена'}
          </span>
        )}
      </div>

      {!sync.enabled ? (
        <>
          <p className="inline-note">
            Сейчас база хранится только в этом браузере — поэтому на другом устройстве её не видно.
            Создайте общую базу и откройте ссылку на телефоне: клиенты, сделки, задачи и график
            появятся там сами, без экспорта файлов.
          </p>
          <div className="save-row">
            <button type="button" className="btn primary" onClick={() => void create()} disabled={busy}>
              <Cloud size={15} /> Создать общую базу
            </button>
            <span className="muted small">код и ссылка появятся сразу после создания</span>
          </div>

          <div className="sync-join">
            <label className="field">
              Код с другого устройства
              <input
                value={input}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || normalizeSyncCode(input).length < MIN_CODE_LENGTH}
              onClick={() => void join(input)}
            >
              <Link2 size={15} /> Подключиться
            </button>
          </div>
          <p className="inline-note">
            Файлы (фото, договоры) остаются на том устройстве, где их добавили: синхронизируются
            только карточки и отметки о вложениях.
          </p>
        </>
      ) : (
        <>
          <div className="sync-code" aria-label="Код общей базы">{formatSyncCode(sync.code)}</div>
          <div className="sync-actions">
            <button type="button" className="btn small ghost" onClick={() => void copy(formatSyncCode(sync.code), 'Код скопирован')}>
              <Copy size={14} /> Скопировать код
            </button>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => void copy(absoluteLink({ view: 'data', sync: sync.code }), 'Ссылка для телефона скопирована')}
            >
              <Link2 size={14} /> Ссылка для телефона
            </button>
          </div>
          <p className="inline-note">
            Введите этот код на втором устройстве в разделе «Данные» или откройте там ссылку —
            база подключится автоматически. Код работает как ключ: никому его не передавайте.
          </p>
          <p className={`sync-state${sync.status === 'error' ? ' error' : ''}`} role="status">{state}</p>
          <div className="save-row">
            <button
              type="button"
              className="btn small"
              disabled={sync.status === 'syncing'}
              onClick={() => void syncNow()}
            >
              <RefreshCw size={14} /> Синхронизировать сейчас
            </button>
            <button type="button" className="btn small danger-ghost" onClick={disableSync}>
              <Unplug size={14} /> Отключить на этом устройстве
            </button>
          </div>
          <p className="inline-note">
            Отключение не удаляет данные: база останется в этом браузере, обмен просто остановится.
          </p>
          {sync.status === 'ok' && (
            <p className="inline-note sync-ok"><Check size={13} /> Изменения с этого устройства уже в общей базе</p>
          )}

          <div className="version-block">
            <div className="section-head tight">
              <div>
                <h3><History size={15} /> Прошлые версии</h3>
                <span className="muted small">если что-то удалили или испортили — можно вернуть</span>
              </div>
              <button
                type="button"
                className="btn small ghost"
                disabled={versionsBusy}
                onClick={() => void showVersions()}
              >
                <RefreshCw size={13} /> {versionsBusy ? 'Смотрим…' : versions ? 'Обновить список' : 'Показать'}
              </button>
            </div>
            {versionsError && <p className="inline-note">{versionsError}</p>}
            {versions && versions.length > 0 && (
              <ul className="version-list">
                {versions.map((version) => (
                  <li key={version.revision} className="version-row">
                    <div>
                      <strong>{fmtDateTime(version.savedAt)}</strong>
                      <span className="muted small">
                        {' '}· {version.deals} {plural(version.deals, 'сделка', 'сделки', 'сделок')},
                        {' '}{version.clients} {plural(version.clients, 'клиент', 'клиента', 'клиентов')}
                        {version.device ? ` · ${version.device}` : ''} · {fmtBytes(version.bytes)}
                      </span>
                    </div>
                    <button type="button" className="btn small ghost" onClick={() => setRestore(version)}>
                      <RotateCcw size={13} /> Вернуть
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {restore && (
        <Modal
          title={`Вернуть базу на ${fmtDateTime(restore.savedAt)}?`}
          subtitle={`версия ${restore.revision} · ${restore.deals} ${plural(restore.deals, 'сделка', 'сделки', 'сделок')} · ${restore.clients} ${plural(restore.clients, 'клиент', 'клиента', 'клиентов')}`}
          onClose={() => setRestore(null)}
          compact
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setRestore(null)}>Отмена</button>
              <button type="button" className="btn primary" disabled={restoring} onClick={() => void confirmRestore()}>
                {restoring ? 'Возвращаем…' : 'Вернуть эту версию'}
              </button>
            </>
          )}
        >
          <p>
            Клиенты, сделки, задачи и график станут такими, какими были на этот момент.
            Всё, что появилось позже, из общей базы уйдёт — на всех устройствах.
          </p>
          <p className="muted small">
            Копия текущего состояния сохранится в этом браузере, и действие можно отменить
            кнопкой «Вернуть» в уведомлении.
          </p>
        </Modal>
      )}

      {invite && (
        <Modal
          title="Подключиться к общей базе?"
          subtitle={`Код ${formatSyncCode(invite)}`}
          onClose={() => { setInvite(''); if (route.sync) navigate({ view: 'data' }); }}
          compact
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => { setInvite(''); if (route.sync) navigate({ view: 'data' }); }}>
                Не сейчас
              </button>
              <button type="button" className="btn primary" onClick={() => void join(invite)} disabled={busy}>
                {busy ? 'Подключаем…' : 'Подключиться'}
              </button>
            </>
          )}
        >
          <p>
            Ссылка пришла с другого устройства. После подключения здесь появятся клиенты, сделки,
            задачи и график монтажей из общей базы.
          </p>
          <p className="muted small">
            Если на этом устройстве уже есть свои записи, они объединятся с общей базой.
            Демо-пример заменится настоящими данными.
          </p>
        </Modal>
      )}
    </section>
  );
}

/** Русское склонение: 1 сделка, 2 сделки, 5 сделок. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
