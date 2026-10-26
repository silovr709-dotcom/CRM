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

/**
 * Возвращает текст всех страниц (до `maxPages`). Пустая строка — текста нет:
 * это скан или фотография, поля придётся заполнить руками.
 */
export async function extractPdfText(blob: Blob, maxPages = 6): Promise<string> {
  if (typeof window === 'undefined') return '';
  try {
    const pdfjs = await import('pdfjs-dist');
    if (!workerReady) {
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      workerReady = true;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const document = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const parts: string[] = [];
    const pages = Math.min(document.numPages, maxPages);
    for (let index = 1; index <= pages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) parts.push(line);
    }
    await document.destroy();
    return parts.join('\n');
  } catch {
    return '';
  }
}
