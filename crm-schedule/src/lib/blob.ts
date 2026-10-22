// Чтение Blob/File с запасным путём через FileReader:
// в старых Safari и jsdom у Blob нет arrayBuffer()/text().

function readWithFileReader(blob: Blob, mode: 'text' | 'buffer'): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result ?? (mode === 'text' ? '' : new ArrayBuffer(0)));
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    if (mode === 'text') reader.readAsText(blob);
    else reader.readAsArrayBuffer(blob);
  });
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Uint8Array(await readWithFileReader(blob, 'buffer') as ArrayBuffer);
}

export async function blobToText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return String(await readWithFileReader(blob, 'text'));
}
