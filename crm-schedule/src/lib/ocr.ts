/* Распознавание сканированных ведомостей (OCR).
 *
 * У бумажного листа, который отсканировали в PDF, текстового слоя нет: внутри
 * файла просто картинка. На телефоне текст «выделяется» за счёт системного
 * распознавания самого телефона, а в файле его нет — поэтому читает только OCR.
 * Движок (tesseract.js) и русская модель грузятся лениво, только по кнопке,
 * и в первый раз требуют интернет; дальше модель лежит в кэше браузера. */

import {
  parseManifestItems, parseManifestText, type ManifestTextItem, type ParsedManifest,
} from './warehouse';
import { isPdfFile, renderPdfPages } from './pdfText';

/**
 * Слова из TSV-ответа OCR превращает в кусочки с координатами страницы.
 * В TSV y растёт сверху вниз, а склад привык к PDF-координатам снизу вверх —
 * переворачиваем вокруг высоты страницы.
 */
export function spansFromTsv(tsv: string, pageHeight: number, page = 1): ManifestTextItem[] {
  const spans: ManifestTextItem[] = [];
  for (const line of tsv.split(/\r?\n/)) {
    const fields = line.split('\t');
    if (fields.length < 12 || fields[0] !== '5') continue;
    const text = fields.slice(11).join(' ').trim();
    if (!text) continue;
    const left = Number(fields[6]);
    const top = Number(fields[7]);
    const width = Number(fields[8]);
    const height = Number(fields[9]);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    spans.push({ str: text, x: left, y: pageHeight - (top + height), width, page });
  }
  return spans;
}

export interface OcrManifestResult {
  parsed: ParsedManifest;
  text: string;
  /** Сколько страниц/кадров распознано. */
  pages: number;
}

/** Размеры одного кадра (фото) для переворота координат OCR. */
async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }
  } catch {
    /* размеры не критичны: разберём по плоскому тексту */
  }
  return { width: 1000, height: 1400 };
}

/**
 * Полный путь: файл → картинки страниц → OCR (рус+англ) → заказы ведомости.
 * Координаты слов сохраняет, поэтому таблица раскладывается по колонкам
 * заказов так же, как у настоящего текстового PDF.
 */
export async function recognizeManifest(
  file: Blob,
  onProgress?: (message: string) => void,
): Promise<OcrManifestResult> {
  onProgress?.('Готовлю страницы…');
  const images: Array<{ blob: Blob; width: number; height: number }> = [];
  if (await isPdfFile(file)) {
    const rendered = await renderPdfPages(file, 4);
    if (rendered.length === 0) throw new Error('не удалось отрисовать страницы PDF');
    images.push(...rendered);
  } else {
    images.push({ blob: file, ...(await imageSize(file)) });
  }

  onProgress?.('Загружаю модель распознавания (в первый раз нужен интернет)…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['rus', 'eng'], 1, {
    logger: (message: { status?: string; progress?: number }) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        onProgress?.(`Распознаю текст… ${Math.round(message.progress * 100)}%`);
      }
    },
  });

  const pageSpans: ManifestTextItem[][] = [];
  const texts: string[] = [];
  try {
    for (let index = 0; index < images.length; index += 1) {
      onProgress?.(images.length > 1
        ? `Распознаю страницу ${index + 1} из ${images.length}…`
        : 'Распознаю текст…');
      const { data } = await worker.recognize(images[index].blob, {}, { text: true, tsv: true });
      texts.push(data.text ?? '');
      pageSpans.push(spansFromTsv(typeof data.tsv === 'string' ? data.tsv : '', images[index].height, index + 1));
    }
  } finally {
    await worker.terminate();
  }

  const text = texts.join('\n');
  const parsed = pageSpans.some((spans) => spans.length > 0)
    ? parseManifestItems(pageSpans)
    : parseManifestText(text);
  return { parsed, text, pages: images.length };
}
