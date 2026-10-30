// Вложения сделок и клиентов. Метаданные лежат в данных приложения (localStorage),
// сами файлы — в IndexedDB: там лимит в сотни мегабайт, а не 5 МБ.
// Когда пользователь вошёл на сервере фирмы, файлы дублируются туда:
// скачиваются по требованию и остаются в IndexedDB как кэш.
import type { Attachment, AttachmentKind } from '../types';

const DB_NAME = 'crm-schedule.files';
const DB_VERSION = 1;
const STORE = 'files';

export type OwnerType = 'deal' | 'client' | 'receipt';

interface StoredFile {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  blob: Blob;
}

/** IndexedDB может быть недоступен: приватный режим, старый браузер, тесты. */
export function attachmentsSupported(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!attachmentsSupported()) return Promise.reject(new Error('Браузер не поддерживает хранение файлов'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('owner', ['ownerType', 'ownerId']);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть хранилище файлов'));
    request.onblocked = () => reject(new Error('Хранилище файлов занято другой вкладкой'));
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  return openDatabase().then((db) => new Promise<T | void>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let request: IDBRequest<T> | void;
    try {
      request = action(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error('Ошибка хранилища файлов'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Запись файла отменена'));
  }));
}

/* --------------------- сервер фирмы как второй дом --------------------- */

/**
 * Серверное хранилище файлов подключает store, когда есть вход на домене.
 * attachments.ts про сервер ничего не знает — только этот интерфейс.
 */
export interface FileRemote {
  upload: (id: string, blob: Blob, meta: { name: string; mime: string; ownerType: string; ownerId: string }) => Promise<void>;
  download: (id: string) => Promise<Blob | null>;
  remove: (id: string) => Promise<void>;
}

let fileRemote: FileRemote | null = null;

export function registerFileRemote(remote: FileRemote | null): void {
  fileRemote = remote;
}

/** Файлы можно подтянуть с сервера фирмы, а не только с этого устройства. */
export function fileRemoteAvailable(): boolean {
  return fileRemote !== null;
}

/** Кладёт файл в хранилище. Метаданные (Attachment) сохраняются отдельно, в сделке/клиенте. */
export async function saveFile(attachment: Attachment, ownerType: OwnerType, ownerId: string, blob: Blob): Promise<void> {
  const record: StoredFile = {
    id: attachment.id,
    ownerType,
    ownerId,
    name: attachment.name,
    mime: attachment.mime || blob.type || 'application/octet-stream',
    size: attachment.size || blob.size,
    createdAt: attachment.createdAt,
    blob,
  };
  await run('readwrite', (store) => store.put(record));
  if (fileRemote) {
    try {
      await fileRemote.upload(attachment.id, blob, {
        name: record.name,
        mime: record.mime,
        ownerType,
        ownerId,
      });
    } catch {
      /* Локально файл сохранён; на сервер подтянется фоновой выгрузкой. */
    }
  }
}

/** Тихо кладёт скачанный с сервера файл в локальный кэш. */
async function cacheDownloaded(id: string, blob: Blob): Promise<void> {
  const record: StoredFile = {
    id,
    ownerType: 'deal',
    ownerId: '',
    name: '',
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    createdAt: new Date().toISOString(),
    blob,
  };
  try {
    await run('readwrite', (store) => store.put(record));
  } catch {
    /* кэш не записался — файл всё равно вернём вызывающему */
  }
}

export async function getFile(id: string): Promise<Blob | null> {
  try {
    const record = await run<StoredFile | undefined>('readonly', (store) => store.get(id));
    if (record?.blob) return record.blob;
  } catch {
    /* локальное хранилище недоступно — попробуем сервер */
  }
  if (fileRemote) {
    const blob = await fileRemote.download(id).catch(() => null);
    if (blob) {
      void cacheDownloaded(id, blob);
      return blob;
    }
  }
  return null;
}

export async function hasFile(id: string): Promise<boolean> {
  return (await getFile(id)) !== null;
}

/**
 * Какие файлы реально лежат в этом браузере. Читаем только ключи — сами блобы
 * не трогаем, поэтому проверка дешёвая даже при сотне вложений.
 * Нужна, чтобы честно показать «файл на другом устройстве», а не «не найден».
 */
export async function localFileIds(): Promise<Set<string>> {
  try {
    const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
    return new Set((keys ?? []).map((key) => String(key)));
  } catch {
    return new Set();
  }
}

/** Сколько файлов из списка реально доступно здесь. */
export async function countLocalFiles(ids: string[]): Promise<number> {
  const local = await localFileIds();
  return ids.filter((id) => local.has(id)).length;
}

export async function removeFile(id: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(id));
  } catch {
    /* файла уже нет — не мешаем удалению записи */
  }
  if (fileRemote) {
    try {
      await fileRemote.remove(id);
    } catch {
      /* на сервере файл уберёт следующая сверка; локально он уже удалён */
    }
  }
}

/** Все файлы — для архива и подсчёта занятого места. */
export async function listFiles(): Promise<Array<{ id: string; size: number; name: string }>> {
  try {
    const records = await run<StoredFile[]>('readonly', (store) => store.getAll() as IDBRequest<StoredFile[]>);
    return (records ?? []).map((record) => ({ id: record.id, size: record.blob.size, name: record.name }));
  } catch {
    return [];
  }
}

/** Удаляет файлы, на которые больше никто не ссылается. */
export async function pruneFiles(validIds: Iterable<string>): Promise<number> {
  const keep = new Set(validIds);
  const records = await run<StoredFile[]>('readonly', (store) => store.getAll() as IDBRequest<StoredFile[]>).catch(() => [] as StoredFile[]);
  let removed = 0;
  for (const record of records ?? []) {
    if (!keep.has(record.id)) {
      await removeFile(record.id);
      removed += 1;
    }
  }
  return removed;
}

export interface StorageInfo {
  supported: boolean;
  usage: number;
  quota: number;
  files: number;
  bytes: number;
}

/** Сколько места занято приложением и сколько всего разрешил браузер. */
export async function storageInfo(): Promise<StorageInfo> {
  const files = await listFiles();
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  let usage = 0;
  let quota = 0;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage ?? 0;
      quota = estimate.quota ?? 0;
    }
  } catch {
    /* оценка недоступна — покажем только размер файлов */
  }
  return { supported: attachmentsSupported(), usage, quota, files: files.length, bytes };
}

/* ------------------------------ разбор файлов ------------------------------ */

const EXT_KINDS: Record<string, AttachmentKind> = {
  jpg: 'photo', jpeg: 'photo', png: 'photo', webp: 'photo', heic: 'photo', gif: 'photo',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  txt: 'document', rtf: 'document', odt: 'document',
  dwg: 'drawing', dxf: 'drawing', skp: 'drawing', obj: 'drawing',
  zip: 'other', rar: 'other',
};

export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

export function detectKind(file: { name: string; mime?: string }): AttachmentKind {
  const ext = fileExtension(file.name);
  if (file.mime?.startsWith('image/')) return 'photo';
  if (file.mime === 'application/pdf') return 'document';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') return 'photo';
  return EXT_KINDS[ext] ?? 'document';
}

export function isImage(attachment: Pick<Attachment, 'mime' | 'kind'>): boolean {
  return attachment.kind === 'photo' || attachment.mime.startsWith('image/');
}

export function fmtBytes(value?: number): string {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} КБ`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

/** Максимальный размер одного файла: больше — сложно и хранить, и открывать. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Большие фото ужимаем перед сохранением — иначе телефон забьёт квоту за месяц. */
export const MAX_IMAGE_SIDE = 1800;

export async function compressImage(blob: Blob): Promise<{ blob: Blob; width?: number; height?: number }> {
  if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') return { blob };
  if (typeof document === 'undefined') return { blob };
  try {
    const bitmap = await loadImage(blob);
    if (!bitmap) return { blob };
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
    if (scale === 1 && blob.size < 900 * 1024) return { blob, width, height };

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return { blob, width, height };
    context.drawImage(bitmap.source, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.82);
    });
    if (!compressed || compressed.size >= blob.size) return { blob, width, height };
    return { blob: compressed, width, height };
  } catch {
    return { blob };
  }
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

async function loadImage(blob: Blob): Promise<LoadedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      /* падаем на <img> */
    }
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}
