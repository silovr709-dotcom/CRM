import { describe, expect, it } from 'vitest';
import { canExtractPdfText, layoutText, type PdfTextSpan } from './pdfText';

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

  it('пустые страницы дают пустой текст — это скан', () => {
    expect(layoutText([])).toBe('');
    expect(layoutText([[]])).toBe('');
  });
});
