/* Текст из PDF-ведомости: если у файла есть текстовый слой, поля формы
 * заполняются сами. Библиотека читалки PDF грузится отдельным файлом и только
 * в момент разбора — на скорость приложения это не влияет. */

let workerReady = false;

/** Есть ли смысл пробовать: PDF читаем, фото — нет (текста там нет). */
export function canExtractPdfText(file: { name?: string; mime?: string }): boolean {
  const mime = file.mime ?? '';
  const name = (file.name ?? '').toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

/** Кусок текста PDF и его место на странице (x/y — левый нижний угол). */
export interface PdfTextSpan {
  str: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

/**
 * Собирает плоский текст из страниц с координатами: кусочки одной строки
 * (близкие по y) идут слева направо, строки — сверху вниз. Таблицы ведомости
 * без этого превращаются в кашу, где не понять, какое число к какому заказу.
 */
export function layoutText(pages: PdfTextSpan[][]): string {
  const output: string[] = [];
  for (const page of pages) {
    const sorted = [...page].filter((item) => item.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: Array<{ y: number; items: PdfTextSpan[] }> = [];
    for (const item of sorted) {
      const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
      if (line) line.items.push(item);
      else lines.push({ y: item.y, items: [item] });
    }
    for (const line of lines.sort((a, b) => b.y - a.y)) {
      const text = [...line.items].sort((a, b) => a.x - b.x).map((item) => item.str.trim()).join(' ');
      if (text) output.push(text);
    }
  }
  return output.join('\n');
}

async function loadDocument(blob: Blob) {
  const pdfjs = await import('pdfjs-dist');
  if (!workerReady) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    workerReady = true;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
}

/**
 * Текст страниц вместе с координатами каждого кусочка. По этим координатам
 * склад раскладывает таблицу ведомости по колонкам заказов.
 */
export async function extractPdfLayout(blob: Blob, maxPages = 6): Promise<PdfTextSpan[][]> {
  if (typeof window === 'undefined') return [];
  try {
    const document = await loadDocument(blob);
    const pages: PdfTextSpan[][] = [];
    const count = Math.min(document.numPages, maxPages);
    for (let index = 1; index <= count; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const spans: PdfTextSpan[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const transform = (item as { transform?: number[] }).transform ?? [];
        spans.push({
          str: item.str,
          x: Number(transform[4] ?? 0),
          y: Number(transform[5] ?? 0),
          width: Number((item as { width?: number }).width ?? 0),
          page: index,
        });
      }
      pages.push(spans);
    }
    await document.destroy();
    return pages;
  } catch {
    return [];
  }
}

/**
 * Возвращает текст всех страниц (до `maxPages`). Пустая строка — текста нет:
 * это скан или фотография, поля придётся заполнить руками.
 */
export async function extractPdfText(blob: Blob, maxPages = 6): Promise<string> {
  const pages = await extractPdfLayout(blob, maxPages);
  return layoutText(pages);
}
