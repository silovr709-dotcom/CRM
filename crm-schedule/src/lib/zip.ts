// ZIP без зависимостей: только «как есть» (store), без сжатия.
// Для фото, PDF и DOCX сжатие почти ничего не даёт, зато формат простой и
// проверяемый тестами. Умеем и собирать архив, и читать свои же архивы.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** unix-время модификации, секунды. */
  mtime?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(mtime?: number): { time: number; date: number } {
  const date = mtime ? new Date(mtime * 1000) : new Date();
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Имя внутри архива: без ведущих «/», «..» и запрещённых символов. */
export function safeEntryName(name: string): string {
  const clean = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/')
    .replace(/[:*?"<>|]/g, '-')
    .trim();
  return clean || 'file';
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

/** Собирает ZIP из файлов. Возвращает Blob — его можно скачать или отдать в File. */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(safeEntryName(entry.name));
    const crc = crc32(entry.data);
    const { time, date } = dosDateTime(entry.mtime);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034B50);
    writeUint16(localView, 4, 20);        // версия для распаковки
    writeUint16(localView, 6, 0x0800);    // имена в UTF-8
    writeUint16(localView, 8, 0);         // метод: store
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, entry.data.length);
    writeUint32(localView, 22, entry.data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    local.set(nameBytes, 30);

    chunks.push(local, entry.data);

    const header = new Uint8Array(46 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    writeUint32(headerView, 0, 0x02014B50);
    writeUint16(headerView, 4, 20);
    writeUint16(headerView, 6, 20);
    writeUint16(headerView, 8, 0x0800);
    writeUint16(headerView, 10, 0);
    writeUint16(headerView, 12, time);
    writeUint16(headerView, 14, date);
    writeUint32(headerView, 16, crc);
    writeUint32(headerView, 20, entry.data.length);
    writeUint32(headerView, 24, entry.data.length);
    writeUint16(headerView, 28, nameBytes.length);
    writeUint16(headerView, 30, 0);
    writeUint16(headerView, 32, 0);
    writeUint16(headerView, 34, 0);
    writeUint16(headerView, 36, 0);
    writeUint32(headerView, 38, 0);
    writeUint32(headerView, 42, offset);
    header.set(nameBytes, 46);
    central.push(header);

    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054B50);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  const parts: BlobPart[] = [...chunks, ...central, end].map((chunk) => {
    // Копия нужна, чтобы Blob не держал ArrayBuffer с лишними байтами.
    const copy = new Uint8Array(chunk.length);
    copy.set(chunk);
    return copy;
  });
  return new Blob(parts, { type: 'application/zip' });
}

export interface ReadZipResult {
  files: ZipEntry[];
  /** Файлы, которые не прочитать (сжатие, шифрование). */
  skipped: string[];
}

/** Читает ZIP, собранный без сжатия (наш экспорт). */
export function readZip(buffer: ArrayBuffer): ReadZipResult {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  const files: ZipEntry[] = [];
  const skipped: string[] = [];

  // Ищем EOCD с конца: там бывает комментарий до 64 КБ.
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65558); index -= 1) {
    if (view.getUint32(index, true) === 0x06054B50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error('Файл не похож на архив ZIP.');

  const total = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  for (let index = 0; index < total; index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014B50) break;
    const method = view.getUint16(pointer + 10, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    if (method !== 0) {
      skipped.push(name);
    } else {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      files.push({ name, data: bytes.slice(start, start + size) });
    }
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return { files, skipped };
}
