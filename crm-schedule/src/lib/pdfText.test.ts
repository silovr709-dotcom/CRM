import { describe, expect, it } from 'vitest';
import { canExtractPdfText, isPdfFile, layoutText, type PdfTextSpan } from './pdfText';

const span = (str: string, x: number, y: number, page = 1): PdfTextSpan => ({ str, x, y, width: 40, page });

describe('текст PDF', () => {
  it('читает только PDF, а не фото', () => {
    expect(canExtractPdfText({ name: 'vedomost.pdf' })).toBe(true);
    expect(canExtractPdfText({ mime: 'application/pdf' })).toBe(true);
    expect(canExtractPdfText({ name: 'photo.jpg', mime: 'image/jpeg' })).toBe(false);
  });

  it('собирает строки сверху вниз и слева направо, а не как попало из файла', () => {
    const text = layoutText([[
      span('1', 320, 650),
      span('Каркас', 20, 650),
      span('91_53d4', 200, 700),
      span('№ заказа', 20, 700),
      span('2', 220, 650),
    ]]);

    expect(text).toBe('№ заказа 91_53d4\nКаркас 2 1');
  });

  it('учитывает тип файла с телефона (type, а не mime) и имя без расширения — нет', () => {
    // Браузерный File кладёт тип в `type`; раньше проверка смотрела только `mime`
    // и имя, поэтому настоящий PDF с телефона получал отказ «это не PDF».
    expect(canExtractPdfText({ name: 'Ведомость', type: 'application/pdf' })).toBe(true);
    expect(canExtractPdfText({ name: 'Ведомость', type: '' })).toBe(false);
    expect(canExtractPdfText({ name: 'scan.PDF' })).toBe(true);
  });

  it('опознаёт PDF по содержимому, как бы файл ни назывался', async () => {
    const pdf = new File(['%PDF-1.7\n%fake'], 'Ведомость', { type: '' });
    await expect(isPdfFile(pdf)).resolves.toBe(true);
    const photo = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await expect(isPdfFile(photo)).resolves.toBe(false);
  });

  it('пустые страницы дают пустой текст — это скан', () => {
    expect(layoutText([])).toBe('');
    expect(layoutText([[]])).toBe('');
  });
});
