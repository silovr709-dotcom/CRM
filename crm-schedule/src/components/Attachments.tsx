// Вложения сделки или клиента: перетащить файлы, сфотографировать, открыть, скачать.
// Файлы лежат в IndexedDB, поэтому карточка остаётся быстрой.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, Download, Eye, FileArchive, FileImage, FileText, Paperclip, PencilRuler,
  Trash2, Upload,
} from 'lucide-react';
import type { Attachment, AttachmentKind } from '../types';
import { useApp } from '../store';
import {
  attachmentsSupported, fileRemoteAvailable, fmtBytes, getFile, isImage, localFileIds, MAX_FILE_BYTES,
} from '../lib/attachments';
import { downloadFile } from '../lib/storage';
import { buildFilesZip } from '../lib/backupZip';
import EmptyState from './EmptyState';

const KIND_META: Record<AttachmentKind, { label: string; icon: typeof FileText }> = {
  photo: { label: 'Фото', icon: FileImage },
  document: { label: 'Документ', icon: FileText },
  drawing: { label: 'Чертёж', icon: PencilRuler },
  contract: { label: 'Договор', icon: FileText },
  other: { label: 'Файл', icon: FileArchive },
};

const ACCEPT = [
  'image/*', 'application/pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.rtf', '.odt',
  '.dwg', '.dxf', '.skp', '.zip', '.rar',
].join(',');

function fmtWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function Attachments({ ownerType, ownerId, attachments = [] }: {
  ownerType: 'deal' | 'client';
  ownerId: string;
  attachments?: Attachment[];
}) {
  const { addAttachments, removeAttachment, notify, settings } = useApp();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  // Какие файлы реально есть в этом браузере: остальные пришли из общей базы
  // с другого устройства — их видно в списке, но открыть здесь нельзя.
  const [localFiles, setLocalFiles] = useState<Set<string> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const supported = attachmentsSupported();

  const totalSize = useMemo(() => attachments.reduce((sum, item) => sum + item.size, 0), [attachments]);
  const idKey = attachments.map((item) => item.id).join(',');
  // При входе на сервере фирмы файл с другого устройства скачается оттуда:
  // «чужим» считаем только то, что недоступно ни здесь, ни на сервере.
  const fetchable = fileRemoteAvailable();
  const remoteCount = !fetchable && localFiles
    ? attachments.filter((item) => !localFiles.has(item.id)).length
    : 0;

  useEffect(() => {
    let active = true;
    if (!supported) {
      setLocalFiles(null);
      return undefined;
    }
    localFileIds()
      .then((ids) => { if (active) setLocalFiles(ids); })
      .catch(() => { if (active) setLocalFiles(new Set()); });
    return () => { active = false; };
  }, [idKey, supported, ownerId]);

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    if (!supported) {
      notify('Браузер не поддерживает хранение файлов — попробуйте другой браузер', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await addAttachments(ownerType, ownerId, files);
      if (result.added > 0) {
        notify(result.added === 1 ? 'Файл добавлен' : `Добавлено файлов: ${result.added}`);
      }
      if (result.failed.length > 0) {
        const first = result.failed[0];
        notify(
          result.failed.length === 1
            ? `«${first.name}»: ${first.reason}`
            : `Не удалось добавить ${result.failed.length} файлов: ${result.failed.map((item) => item.name).join(', ').slice(0, 120)}`,
          'error',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    void upload(files);
  };

  const openInNewTab = async (attachment: Attachment) => {
    const blob = await getFile(attachment.id);
    if (!blob) {
      notify('Этот файл добавлен на другом устройстве — откройте карточку там или перенесите файлы архивом .zip', 'info');
      return;
    }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const save = async (attachment: Attachment) => {
    const blob = await getFile(attachment.id);
    if (!blob) {
      notify('Этот файл добавлен на другом устройстве — скачать его можно там', 'info');
      return;
    }
    downloadFile(attachment.name, blob, attachment.mime);
  };

  const saveAll = async () => {
    if (attachments.length === 0) return;
    const { blob, files, missing } = await buildFilesZip(attachments);
    if (files === 0) {
      notify('Эти файлы добавлены на другом устройстве — здесь их нет', 'info');
      return;
    }
    const client = ownerType === 'deal' ? 'сделка' : 'клиент';
    downloadFile(`файлы-${client}-${new Date().toISOString().slice(0, 10)}.zip`, blob, 'application/zip');
    notify(missing > 0 ? `Скачано файлов: ${files}, не найдено: ${missing}` : `Скачано файлов: ${files}`);
  };

  const remove = (attachment: Attachment) => {
    if (!confirm(`Удалить файл «${attachment.name}»?`)) return;
    removeAttachment(ownerType, ownerId, attachment.id);
  };

  const limits = `до ${fmtBytes(MAX_FILE_BYTES)} на файл`;

  return (
    <div className="attachments">
      <div
        className={`dropzone${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Upload size={19} />
        <div className="dropzone-text">
          <b>{busy ? 'Загружаем…' : 'Перетащите файлы сюда'}</b>
          <span>
            Договор, эскиз, чек или фото объекта. Изображения ужимаются,
            {` ${limits}.`}
          </span>
        </div>
        <div className="dropzone-actions">
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} /> Выбрать
          </button>
          <button type="button" className="btn small ghost" disabled={busy} onClick={() => cameraRef.current?.click()} title="Снять на камеру телефона">
            <Camera size={14} /> Снимок
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            void upload(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>

      {!supported && (
        <div className="inline-warning">
          Этот браузер не даёт сохранять файлы (IndexedDB недоступен). Открывайте приложение
          в обычном окне Chrome, Safari или Firefox.
        </div>
      )}

      {attachments.length === 0 ? (
        <EmptyState
          compact
          icon={<Paperclip size={20} />}
          title="Файлов пока нет"
          hint="Договор, эскизы, фото замера и чеки — всё в одном месте, рядом со сделкой."
        />
      ) : (
        <>
          <div className="attachments-head">
            <span className="muted">
              {attachments.length} {attachments.length === 1 ? 'файл' : attachments.length < 5 ? 'файла' : 'файлов'} · {fmtBytes(totalSize)}
            </span>
            <button type="button" className="link-btn" onClick={saveAll}>
              <Download size={13} /> Скачать всё (zip)
            </button>
          </div>
          <ul className="attachment-list">
            {attachments.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                remote={Boolean(localFiles && !localFiles.has(attachment.id)) && !fetchable}
                onOpen={() => openInNewTab(attachment)}
                onPreview={() => setPreview(attachment)}
                onSave={() => save(attachment)}
                onRemove={() => remove(attachment)}
              />
            ))}
          </ul>
        </>
      )}

      {remoteCount > 0 && (
        <div className="inline-note attachment-remote">
          <Paperclip size={13} /> Файлов с других устройств: {remoteCount}. Они есть в списке
          (пришли через общую базу), но сами файлы лежат там, где их добавили.
          Перенести — архивом в «Данных» или добавить заново здесь.
        </div>
      )}

      <p className="field-hint">
        {fetchable
          ? 'Файлы хранятся на сервере фирмы и открываются на всех устройствах. В JSON-копию входят только описания файлов.'
          : 'В JSON-копию входят только описания файлов. Чтобы перенести сами файлы, скачайте архив в «Данных» или по кнопке «Скачать всё».'}
        {settings.myName ? ` Добавил: ${settings.myName}.` : ''}
      </p>

      {preview && <PreviewModal attachment={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function AttachmentRow({ attachment, remote, onOpen, onPreview, onSave, onRemove }: {
  attachment: Attachment;
  /** Файл пришёл с другого устройства: открыть и скачать здесь нельзя. */
  remote: boolean;
  onOpen: () => void;
  onPreview: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const meta = KIND_META[attachment.kind] ?? KIND_META.other;
  const Icon = meta.icon;
  const [thumb, setThumb] = useState<string>('');

  useEffect(() => {
    if (!isImage(attachment)) return;
    let url = '';
    let active = true;
    getFile(attachment.id).then((blob) => {
      if (!blob || !active) return;
      url = URL.createObjectURL(blob);
      setThumb(url);
    }).catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment]);

  return (
    <li className="attachment-row">
      <span className={`attachment-icon kind-${attachment.kind}`}>
        {thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon size={16} />}
      </span>
      <span className="attachment-main">
        <b title={attachment.name}>{attachment.name}</b>
        <span>
          {meta.label} · {fmtBytes(attachment.size)} · {fmtWhen(attachment.createdAt)}
          {attachment.addedBy ? ` · ${attachment.addedBy}` : ''}
          {remote && <i className="attachment-remote-chip" title="Файл лежит на устройстве, где его добавили"> · на другом устройстве</i>}
        </span>
      </span>
      <span className="attachment-actions">
        {remote ? (
          <button
            type="button"
            className="icon-btn"
            disabled
            title="Файл на другом устройстве"
            aria-label={`${attachment.name}: файл на другом устройстве`}
          >
            <Eye size={15} />
          </button>
        ) : isImage(attachment) ? (
          <button type="button" className="icon-btn" title="Посмотреть" aria-label={`Посмотреть ${attachment.name}`} onClick={onPreview}>
            <Eye size={15} />
          </button>
        ) : (
          <button type="button" className="icon-btn" title="Открыть" aria-label={`Открыть ${attachment.name}`} onClick={onOpen}>
            <Eye size={15} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          title={remote ? 'Файл на другом устройстве' : 'Скачать'}
          aria-label={`Скачать ${attachment.name}`}
          disabled={remote}
          onClick={onSave}
        >
          <Download size={15} />
        </button>
        <button type="button" className="icon-btn danger" title="Удалить" aria-label={`Удалить ${attachment.name}`} onClick={onRemove}>
          <Trash2 size={15} />
        </button>
      </span>
    </li>
  );
}

function PreviewModal({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let objectUrl = '';
    let active = true;
    getFile(attachment.id).then((blob) => {
      if (!blob || !active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  return (
    <div
      className="image-preview"
      role="dialog"
      aria-label={`Просмотр ${attachment.name}`}
      onClick={onClose}
    >
      <div className="image-preview-inner" onClick={(event) => event.stopPropagation()}>
        {url ? <img src={url} alt={attachment.name} /> : <div className="muted">Загружаем файл…</div>}
        <div className="image-preview-bar">
          <span>{attachment.name}</span>
          <span className="muted">{fmtBytes(attachment.size)}</span>
          <button type="button" className="btn small ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
