// Резервная копия вместе с файлами: один ZIP = data.json + папка files.
// JSON-копия остаётся лёгкой и по-прежнему работает — в неё входят только
// описания вложений. Архив нужен, когда переезжаем на другой компьютер.
import type { AppData, Attachment } from '../types';
import { createZip, readZip, safeEntryName, type ZipEntry } from './zip';
import { getFile, saveFile } from './attachments';
import { normalizeAttachments } from './storage';
import { blobToBytes } from './blob';

const DATA_FILE = 'data.json';
const FILES_DIR = 'files/';

/** Имя файла внутри архива: id впереди, чтобы восстановление не зависело от имени. */
export function archiveName(attachment: Attachment): string {
  return `${FILES_DIR}${attachment.id}__${safeEntryName(attachment.name)}`;
}

export function attachmentIdFromArchive(name: string): string {
  const base = name.startsWith(FILES_DIR) ? name.slice(FILES_DIR.length) : name;
  const index = base.indexOf('__');
  return index > 0 ? base.slice(0, index) : '';
}

/** Все вложения из данных — со ссылкой на владельца. */
export function collectAttachments(data: AppData): Array<{ ownerType: 'deal' | 'client' | 'receipt'; ownerId: string; attachment: Attachment }> {
  const result: Array<{ ownerType: 'deal' | 'client' | 'receipt'; ownerId: string; attachment: Attachment }> = [];
  for (const deal of data.deals ?? []) {
    for (const attachment of deal.attachments ?? []) {
      result.push({ ownerType: 'deal', ownerId: deal.id, attachment });
    }
  }
  for (const client of data.clients ?? []) {
    for (const attachment of client.attachments ?? []) {
      result.push({ ownerType: 'client', ownerId: client.id, attachment });
    }
  }
  // Ведомости склада — такие же файлы: без них архив терял бы документы приходов.
  for (const receipt of data.receipts ?? []) {
    if (receipt.file) result.push({ ownerType: 'receipt', ownerId: receipt.id, attachment: receipt.file });
  }
  return result;
}

/** Полная копия: данные и все файлы. */
export async function buildBackupZip(data: AppData, payload: unknown): Promise<{ blob: Blob; files: number; missing: number }> {
  const entries: ZipEntry[] = [{
    name: DATA_FILE,
    data: new TextEncoder().encode(JSON.stringify(payload, null, 2)),
    mtime: Math.floor(Date.now() / 1000),
  }];
  let files = 0;
  let missing = 0;
  for (const { attachment } of collectAttachments(data)) {
    const blob = await getFile(attachment.id);
    if (!blob) { missing += 1; continue; }
    entries.push({
      name: archiveName(attachment),
      data: await blobToBytes(blob),
      mtime: Math.floor(new Date(attachment.createdAt).getTime() / 1000) || undefined,
    });
    files += 1;
  }
  return { blob: createZip(entries), files, missing };
}

/** Архив с файлами одного владельца — «скачать всё по сделке». */
export async function buildFilesZip(attachments: Attachment[]): Promise<{ blob: Blob; files: number; missing: number }> {
  const entries: ZipEntry[] = [];
  let missing = 0;
  for (const attachment of attachments) {
    const blob = await getFile(attachment.id);
    if (!blob) { missing += 1; continue; }
    entries.push({
      name: safeEntryName(attachment.name) || `file-${attachment.id}`,
      data: await blobToBytes(blob),
      mtime: Math.floor(new Date(attachment.createdAt).getTime() / 1000) || undefined,
    });
  }
  // Пустой архив скачивать бессмысленно.
  return { blob: createZip(entries), files: entries.length, missing };
}

export interface ArchiveImport {
  /** Данные из data.json — та же структура, что у обычной JSON-копии. */
  payload: unknown;
  blobs: Map<string, Blob>;
  files: number;
  skipped: string[];
}

/** Читает наш архив: JSON + файлы. Незнакомые/сжатые файлы пропускает. */
export async function readBackupZip(file: File): Promise<ArchiveImport> {
  const { files, skipped } = readZip((await blobToBytes(file)).buffer as ArrayBuffer);
  const dataEntry = files.find((entry) => entry.name === DATA_FILE || entry.name.endsWith('/data.json'));
  if (!dataEntry) throw new Error('В архиве нет data.json — это не копия CRM и графика.');
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(dataEntry.data));
  } catch {
    throw new Error('data.json в архиве повреждён.');
  }
  const blobs = new Map<string, Blob>();
  for (const entry of files) {
    if (!entry.name.startsWith(FILES_DIR)) continue;
    const id = attachmentIdFromArchive(entry.name);
    if (!id) continue;
    const described = findAttachment(payload, id);
    const type = described?.mime || 'application/octet-stream';
    blobs.set(id, new Blob([entry.data.slice().buffer as ArrayBuffer], { type }));
  }
  return { payload, blobs, files: blobs.size, skipped };
}

function findAttachment(payload: unknown, id: string): Attachment | null {
  const data = payload as Partial<AppData> | null;
  if (!data) return null;
  const lists: unknown[] = [
    ...(Array.isArray(data.deals) ? data.deals.map((deal) => deal.attachments) : []),
    ...(Array.isArray(data.clients) ? data.clients.map((client) => client.attachments) : []),
    ...(Array.isArray(data.receipts) ? data.receipts.map((receipt) => (receipt.file ? [receipt.file] : [])) : []),
  ];
  for (const list of lists) {
    const found = normalizeAttachments(list).find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

/** Кладёт файлы из архива в IndexedDB, привязывая к сделкам и клиентам. */
export async function restoreArchiveFiles(data: AppData, blobs: Map<string, Blob>): Promise<{ saved: number; missing: number }> {
  let saved = 0;
  let missing = 0;
  for (const { ownerType, ownerId, attachment } of collectAttachments(data)) {
    const blob = blobs.get(attachment.id);
    if (!blob) { missing += 1; continue; }
    try {
      await saveFile(attachment, ownerType, ownerId, blob);
      saved += 1;
    } catch {
      missing += 1;
    }
  }
  return { saved, missing };
}
