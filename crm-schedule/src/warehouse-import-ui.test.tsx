// @vitest-environment jsdom
// Загрузка ведомости целиком: PDF разбирается на заказы, они записываются пачкой.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData, STORAGE_KEY } from './lib/storage';
import type { AppData } from './types';
import type { PdfTextSpan } from './lib/pdfText';

// Настоящий pdfjs в тестах не нужен: отдаём ему готовую геометрию бланка Visma.
vi.mock('./lib/pdfText', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/pdfText')>();
  const span = (str: string, x: number, y: number, width = 40): PdfTextSpan => ({ str, x, y, width, page: 1 });
  const order = (str: string, center: number, y: number) => span(str, center - 25, y, 50);
  const qty = (value: number, center: number, y: number) => span(String(value), center - 5, y, 10);
  const c1 = 225; const c2 = 325; const c3 = 425;
  const layout: PdfTextSpan[][] = [[
    span('Дата отгрузки: 11.06.2026', 20, 760, 180),
    span('№ заказа', 20, 700, 60),
    order('91_53d4', c1, 700), order('91_61d2', c2, 700), order('91_15dr', c3, 700),
    span('Каркас', 20, 650, 60), qty(2, c1, 650), qty(1, c2, 650), qty(2, c3, 650),
    span('Фасады', 20, 620, 60), qty(1, c2, 620), qty(5, c3, 620),
    span('Цоколь ПВХ', 20, 590, 90), qty(1, c2, 590),
    span('Фурнитура', 20, 560, 70), qty(1, c1, 560), qty(1, c2, 560),
    span('Итого (кол-во упаковок)', 20, 530, 170), qty(3, c1, 530), qty(4, c2, 530), qty(7, c3, 530),
    span('ФИО водителя: Сергей Кузьмин', 20, 480, 220),
  ]];
  return {
    ...actual,
    isPdfFile: actual.isPdfFile,
    readPdf: vi.fn(async (file: Blob & { name?: string }) => (file?.name?.includes('scan')
      ? { pages: [], text: '' }
      : { pages: layout, text: actual.layoutText(layout) })),
    extractPdfLayout: vi.fn(async () => layout),
  };
});

// OCR в тестах не гоняем по-настоящему: отдаём ему готовые слова скана.
vi.mock('./lib/ocr', async () => {
  const warehouse = await import('./lib/warehouse');
  const span = (str: string, x: number, y: number, width = 40) => ({ str, x, y, width });
  const spans = [
    span('91_53d4', 200, 700, 50),
    span('Каркас', 20, 650, 60), span('2', 220, 650, 10),
    span('Фурнитура', 20, 620, 70), span('1', 220, 620, 10),
    span('Итого (кол-во упаковок)', 20, 590, 170), span('3', 220, 590, 10),
  ];
  return {
    recognizeManifest: vi.fn(async () => ({
      parsed: warehouse.parseManifestItems([spans]),
      text: '91_53d4 Каркас 2 Фурнитура 1 Итого 3',
      pages: 1,
    })),
  };
});

// Файлы в тестах хранить негде (нет IndexedDB) — сохранение файла подменяем.
vi.mock('./lib/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/attachments')>();
  return { ...actual, saveFile: vi.fn(async () => {}) };
});

function makeData(): AppData {
  const base = emptyData();
  return {
    ...base,
    settings: { ...base.settings, demo: false, companyName: 'Кухни Лада', myName: 'Ирина', role: 'owner' },
    clients: [{
      id: 'client-1', name: 'Анна Смирнова', phones: ['+7 900 111-22-33'], emails: [], tags: [],
      createdAt: '2026-05-01T09:00:00.000Z', updatedAt: '2026-05-01T09:00:00.000Z',
    }],
    deals: [{
      id: 'deal-1', title: 'Кухня на Ленина', orderNo: '91_53d4', clientId: 'client-1',
      amount: 285000, status: 'approved', tasks: [], payments: [], history: [],
      schedule: { status: 'planned' },
      createdAt: '2026-05-01T09:00:00.000Z', updatedAt: '2026-05-02T09:00:00.000Z',
    }],
    receipts: [],
    updatedAt: '2026-05-02T09:00:00.000Z',
  };
}

function renderWarehouse() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(makeData()));
  window.location.hash = '#/warehouse';
  render(<AppProvider><App /></AppProvider>);
}

async function storedReceipts(): Promise<AppData['receipts']> {
  let data: AppData | undefined;
  await waitFor(() => {
    window.dispatchEvent(new Event('beforeunload'));
    const raw = localStorage.getItem(STORAGE_KEY);
    data = raw ? JSON.parse(raw) as AppData : undefined;
    expect(data?.receipts.length).toBeGreaterThan(0);
  }, { timeout: 12_000 });
  return (data as AppData).receipts;
}

beforeEach(() => {
  vi.setConfig({ testTimeout: 20_000 });
  localStorage.clear();
  window.scrollTo = () => {};
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('загрузка ведомости целиком', () => {
  it('PDF сам находит заказы, упаковки и позиции по каждому', async () => {
    renderWarehouse();

    fireEvent.click(screen.getByRole('button', { name: /Ведомость PDF/ }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Файл ведомости');
    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.4'], 'vedomost.pdf', { type: 'application/pdf' })] },
    });

    expect(await within(dialog).findByText(/Нашёл заказов: 3/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Номер заказа 1') as HTMLInputElement).value).toBe('91_53d4');
    expect((within(dialog).getByLabelText('Номер заказа 2') as HTMLInputElement).value).toBe('91_61d2');
    expect((within(dialog).getByLabelText('Номер заказа 3') as HTMLInputElement).value).toBe('91_15dr');
    expect((within(dialog).getByLabelText('Упаковок у заказа 91_53d4') as HTMLInputElement).value).toBe('3');
    expect((within(dialog).getByLabelText('Упаковок у заказа 91_61d2') as HTMLInputElement).value).toBe('4');
    expect((within(dialog).getByLabelText('Упаковок у заказа 91_15dr') as HTMLInputElement).value).toBe('7');
    // Позиции именно по своим заказам: фасады у первого пустые, у третьего — 5.
    expect(within(dialog).getByLabelText('Количество 2 заказа 91_15dr')).toBeTruthy();
    expect((within(dialog).getByLabelText('Количество 2 заказа 91_15dr') as HTMLInputElement).value).toBe('5');
    expect(within(dialog).getByText(/сделка: Кухня на Ленина/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Водитель') as HTMLInputElement).value).toContain('Сергей');
  });

  it('принимает PDF без расширения в имени — как его отдаёт телефон', async () => {
    renderWarehouse();

    fireEvent.click(screen.getByRole('button', { name: /Ведомость PDF/ }));
    const dialog = await screen.findByRole('dialog');
    // Телефон и мессенджеры часто отдают файл без «.pdf» и без типа —
    // приложение должно смотреть содержимое, а не название.
    fireEvent.change(within(dialog).getByLabelText('Файл ведомости'), {
      target: { files: [new File(['%PDF-1.4'], 'Ведомость с фабрики', { type: '' })] },
    });

    expect(await within(dialog).findByText(/Нашёл заказов: 3/)).toBeTruthy();
  });

  it('записывает отмеченные заказы пачкой, с одним файлом на всех', async () => {
    renderWarehouse();

    fireEvent.click(screen.getByRole('button', { name: /Ведомость PDF/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Файл ведомости'), {
      target: { files: [new File(['%PDF-1.4'], 'vedomost.pdf', { type: 'application/pdf' })] },
    });
    await within(dialog).findByText(/Нашёл заказов: 3/);

    // Третий заказ сегодня не принимаем — снимаем отметку.
    fireEvent.click(within(dialog).getByLabelText('Записать заказ 91_15dr'));
    fireEvent.click(within(dialog).getByRole('button', { name: /Записать приходы: 2/ }));

    const receipts = await storedReceipts();
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.orderNo)).toEqual(['91_53d4', '91_61d2']);
    expect(receipts[0]).toMatchObject({
      packages: 3,
      items: [{ name: 'Каркас', qty: 2 }, { name: 'Фурнитура', qty: 1 }],
      dealId: 'deal-1',
      shippedAt: '2026-06-11',
    });
    expect(receipts[1]).toMatchObject({
      packages: 4,
      items: [
        { name: 'Каркас', qty: 1 },
        { name: 'Фасады', qty: 1 },
        { name: 'Цоколь ПВХ', qty: 1 },
        { name: 'Фурнитура', qty: 1 },
      ],
    });
    expect(receipts[0].file?.name).toBe('vedomost.pdf');
    expect(receipts[0].file?.id).toBe(receipts[1].file?.id);
    expect(await screen.findByText('91_61d2')).toBeTruthy();
  });

  it('без PDF заказы можно набить вручную и тоже записать пачкой', async () => {
    renderWarehouse();

    fireEvent.click(screen.getByRole('button', { name: /Ведомость PDF/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Заказ вручную/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Заказ вручную/ }));

    fireEvent.change(within(dialog).getByLabelText('Номер заказа 1'), { target: { value: '91_77aa' } });
    fireEvent.change(within(dialog).getByLabelText('Упаковок у заказа 91_77aa'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('Номер заказа 2'), { target: { value: '91_88bb' } });
    fireEvent.change(within(dialog).getByLabelText('Упаковок у заказа 91_88bb'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Записать приходы: 2/ }));

    const receipts = await storedReceipts();
    expect(receipts.map((receipt) => [receipt.orderNo, receipt.packages])).toEqual([
      ['91_77aa', 2],
      ['91_88bb', 5],
    ]);
  });

  it('скан без текстового слоя распознаётся через OCR', async () => {
    renderWarehouse();

    fireEvent.click(screen.getByRole('button', { name: /Ведомость PDF/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Файл ведомости'), {
      target: { files: [new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })] },
    });

    expect(await within(dialog).findByText(/это скан/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Распознать скан/ }));

    expect(await within(dialog).findByText(/Нашёл заказов: 1/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Номер заказа 1') as HTMLInputElement).value).toBe('91_53d4');
    expect((within(dialog).getByLabelText('Упаковок у заказа 91_53d4') as HTMLInputElement).value).toBe('3');
    fireEvent.click(within(dialog).getByRole('button', { name: /Записать приходы: 1/ }));

    const receipts = await storedReceipts();
    expect(receipts[0]).toMatchObject({
      orderNo: '91_53d4',
      packages: 3,
      items: [{ name: 'Каркас', qty: 2 }, { name: 'Фурнитура', qty: 1 }],
    });
  });

  it('не записывает заказ без номера и объясняет почему', async () => {
    renderWarehouse();

    fireEvent.click(screen.getByRole('button', { name: /Ведомость PDF/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Заказ вручную/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Записать приходы: 1/ }));

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain('не указан номер');
  });
});
