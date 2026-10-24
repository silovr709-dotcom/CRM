// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveName, buildBackupZip, buildFilesZip, collectAttachments, readBackupZip,
  restoreArchiveFiles,
} from './backupZip';
import { createZip, readZip, crc32, safeEntryName } from './zip';
import {
  countLocalFiles, detectKind, fmtBytes, getFile, listFiles, localFileIds, pruneFiles,
  removeFile, saveFile, storageInfo,
} from './attachments';
import { blobToBytes, blobToText } from './blob';
import { demoData } from './demoData';
import { makeDeal } from './testUtils';
import type { Attachment } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const blobText = (blob: Blob) => blobToText(blob);
const blobBuffer = async (blob: Blob) => (await blobToBytes(blob)).buffer as ArrayBuffer;

function makeAttachment(patch: Partial<Attachment> = {}): Attachment {
  return {
    id: `file-${Math.random().toString(36).slice(2, 8)}`,
    name: 'договор.pdf',
    mime: 'application/pdf',
    size: 12,
    kind: 'document',
    createdAt: new Date().toISOString(),
    ...patch,
  };
}

describe('ZIP без зависимостей', () => {
  it('собирает и читает архив обратно', () => {
    const zip = createZip([
      { name: 'data.json', data: encoder.encode('{"ok":true}') },
      { name: 'files/фото.jpg', data: new Uint8Array([1, 2, 3, 4, 5]) },
    ]);
    return blobBuffer(zip).then((buffer) => {
      const { files, skipped } = readZip(buffer);
      expect(skipped).toEqual([]);
      expect(files.map((file) => file.name)).toEqual(['data.json', 'files/фото.jpg']);
      expect(decoder.decode(files[0].data)).toBe('{"ok":true}');
      expect(Array.from(files[1].data)).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('считает контрольную сумму и чистит опасные имена', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xCBF43926);
    expect(safeEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(safeEntryName('фото: 1.jpg')).toBe('фото- 1.jpg');
    expect(safeEntryName('')).toBe('file');
  });

  it('отказывается читать не-zip', () => {
    expect(() => readZip(encoder.encode('не архив').buffer)).toThrow(/ZIP/u);
  });
});

describe('хранилище вложений', () => {
  beforeEach(async () => {
    const files = await listFiles();
    await Promise.all(files.map((file) => removeFile(file.id)));
  });

  it('сохраняет, находит и удаляет файл', async () => {
    const attachment = makeAttachment();
    await saveFile(attachment, 'deal', 'deal-1', new Blob(['договор'], { type: 'application/pdf' }));
    const blob = await getFile(attachment.id);
    expect(blob).toBeTruthy();
    expect(await blobText(blob as Blob)).toBe('договор');
    expect((await listFiles()).some((file) => file.id === attachment.id)).toBe(true);
    await removeFile(attachment.id);
    expect(await getFile(attachment.id)).toBeNull();
  });

  it('убирает файлы-сироты, не трогая нужные', async () => {
    const keep = makeAttachment({ name: 'нужный.pdf' });
    const orphan = makeAttachment({ name: 'лишний.pdf' });
    await saveFile(keep, 'deal', 'deal-1', new Blob(['a']));
    await saveFile(orphan, 'client', 'client-1', new Blob(['b']));
    const removed = await pruneFiles([keep.id]);
    expect(removed).toBe(1);
    expect(await getFile(keep.id)).toBeTruthy();
    expect(await getFile(orphan.id)).toBeNull();
  });

  it('определяет тип файла и размер', () => {
    expect(detectKind({ name: 'фото.JPG' })).toBe('photo');
    expect(detectKind({ name: 'смета.xlsx' })).toBe('document');
    expect(detectKind({ name: 'эскиз.dwg' })).toBe('drawing');
    expect(detectKind({ name: 'без расширения' })).toBe('document');
    expect(fmtBytes(900)).toBe('900 Б');
    expect(fmtBytes(2048)).toBe('2.0 КБ');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 МБ');
  });

  it('отдаёт сводку по месту', async () => {
    const info = await storageInfo();
    expect(info.supported).toBe(true);
    expect(info.files).toBeGreaterThanOrEqual(0);
    expect(info.bytes).toBeGreaterThanOrEqual(0);
  });
});

describe('архив копии с файлами', () => {
  beforeEach(async () => {
    const files = await listFiles();
    await Promise.all(files.map((file) => removeFile(file.id)));
  });

  function dataWithFiles() {
    const data = demoData();
    const dealAttachment = makeAttachment({ id: 'file-deal', name: 'договор.pdf', mime: 'application/pdf' });
    const clientAttachment = makeAttachment({ id: 'file-client', name: 'фото.jpg', mime: 'image/jpeg', kind: 'photo' });
    data.deals[0] = { ...data.deals[0], attachments: [dealAttachment] };
    data.clients[0] = { ...data.clients[0], attachments: [clientAttachment] };
    return { data, dealAttachment, clientAttachment };
  }

  it('собирает data.json и файлы, а потом читает их обратно', async () => {
    const { data, dealAttachment, clientAttachment } = dataWithFiles();
    await saveFile(dealAttachment, 'deal', data.deals[0].id, new Blob(['договор'], { type: 'application/pdf' }));
    await saveFile(clientAttachment, 'client', data.clients[0].id, new Blob(['фото'], { type: 'image/jpeg' }));

    const payload = { kind: 'crm-schedule-backup', version: 2, clients: data.clients, deals: data.deals };
    const { blob, files, missing } = await buildBackupZip(data, payload);
    expect(files).toBe(2);
    expect(missing).toBe(0);

    const file = new File([blob], 'crm.zip', { type: 'application/zip' });
    const archive = await readBackupZip(file);
    expect(archive.files).toBe(2);
    expect(archive.blobs.size).toBe(2);
    expect(await blobText(archive.blobs.get('file-deal') as Blob)).toBe('договор');
    expect(await blobText(archive.blobs.get('file-client') as Blob)).toBe('фото');
    expect(archive.skipped).toEqual([]);
  });

  it('восстанавливает файлы после импорта данных', async () => {
    const { data, dealAttachment } = dataWithFiles();
    const restoredData = { ...data, deals: [{ ...data.deals[0], attachments: [dealAttachment] }] };
    const result = await restoreArchiveFiles(restoredData, new Map([
      [dealAttachment.id, new Blob(['из архива'])],
    ]));
    expect(result.saved).toBe(1);
    expect(await blobText((await getFile(dealAttachment.id)) as Blob)).toBe('из архива');
  });

  it('скачивает файлы одного владельца и пропускает отсутствующие', async () => {
    const present = makeAttachment({ id: 'file-1', name: 'чек.pdf' });
    await saveFile(present, 'deal', 'deal-1', new Blob(['чек']));
    const { blob, files, missing } = await buildFilesZip([present, makeAttachment({ id: 'нет-файла' })]);
    expect(files).toBe(1);
    expect(missing).toBe(1);
    const { files: entries } = readZip(await blobBuffer(blob));
    expect(entries[0].name).toBe('чек.pdf');
  });

  it('находит вложения у сделок и клиентов', () => {
    const { data } = dataWithFiles();
    const all = collectAttachments(data);
    expect(all.map((item) => item.ownerType).sort()).toEqual(['client', 'deal']);
    expect(archiveName(makeAttachment({ id: 'x', name: 'файл 1.pdf' }))).toBe('files/x__файл 1.pdf');
  });

  it('понятно ругается на архив без data.json', async () => {
    const zip = createZip([{ name: 'readme.txt', data: encoder.encode('привет') }]);
    const file = new File([zip], 'x.zip', { type: 'application/zip' });
    await expect(readBackupZip(file)).rejects.toThrow(/data\.json/u);
  });
});

describe('вложения в данных сделки', () => {
  it('переживают мягкую проверку данных', async () => {
    const { validateData } = await import('./storage');
    const deal = makeDeal({ attachments: [makeAttachment({ id: 'keep-me' }), { id: '' } as Attachment] });
    const data = validateData({ version: 2, clients: [], deals: [deal], settings: {} });
    expect(data?.deals[0].attachments).toHaveLength(1);
    expect(data?.deals[0].attachments?.[0].id).toBe('keep-me');
  });
});

describe('какие файлы есть на этом устройстве', () => {
  it('возвращает только то, что реально лежит в этом браузере', async () => {
    const local = makeAttachment({ name: 'фото-замера.jpg', kind: 'photo' });
    await saveFile(local, 'deal', 'deal-local', new Blob([encoder.encode('фото')]));

    const ids = await localFileIds();
    expect(ids.has(local.id)).toBe(true);
    expect(ids.has('file-с-другого-устройства')).toBe(false);

    expect(await countLocalFiles([local.id, 'file-с-другого-устройства'])).toBe(1);
  });

  it('не падает, если файлов нет вообще', async () => {
    await removeFile('file-которого-нет');
    const ids = await localFileIds();
    expect(ids instanceof Set).toBe(true);
  });
});
