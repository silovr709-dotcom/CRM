// Минимальный клиент S3-совместимого хранилища (Timeweb S3, path-style).
// Без внешних зависимостей: подпись AWS Signature V4 считается через node:crypto.
// Модуль намеренно не знает про базу — его можно вызвать до открытия SQLite.

import { createHash, createHmac } from 'node:crypto';

const endpoint = (process.env.S3_ENDPOINT || 'https://s3.twcstorage.ru').replace(/\/+$/, '');
const bucket = process.env.S3_BUCKET || '';
const region = process.env.S3_REGION || 'ru-1';
const accessKey = process.env.S3_ACCESS_KEY || '';
const secretKey = process.env.S3_SECRET_KEY || '';

export const s3Enabled = Boolean(bucket && accessKey && secretKey);
export const s3Info = () => ({ enabled: s3Enabled, endpoint, bucket, region });

const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, str) => createHmac('sha256', key).update(str, 'utf8').digest();

function amzStamps(date = new Date()) {
  const amzDate = date.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

// Ключ объекта → путь запроса (каждый сегмент кодируется отдельно, «/» остаются)
const encodeKey = (key) => String(key).split('/').map(encodeURIComponent).join('/');

export function signRequest({ method, key, body = Buffer.alloc(0), query = {}, date = new Date(), extraHeaders = {} }) {
  const url = new URL(`${endpoint}/${bucket}/${encodeKey(key)}`);
  const queryPairs = Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1));
  const canonicalQuery = queryPairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
    .join('&');
  for (const [k, v] of queryPairs) url.searchParams.set(k, v ?? '');

  const payloadHash = sha256hex(body);
  const { amzDate, dateStamp } = amzStamps(date);

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), String(v)])),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map(n => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${secretKey}`, dateStamp);
  signingKey = hmac(signingKey, region);
  signingKey = hmac(signingKey, 's3');
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host; // host проставит сам fetch

  return { url: url.toString(), headers, signature, canonicalRequest, stringToSign };
}

async function call(method, key, { body = Buffer.alloc(0), query, extraHeaders, timeoutMs = 60_000 } = {}) {
  if (!s3Enabled) throw new Error('S3 не настроен (нет S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY)');
  const { url, headers } = signRequest({ method, key, body, query, extraHeaders });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : body,
      signal: ac.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function putObject(key, body, contentType = 'application/octet-stream') {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const res = await call('PUT', key, { body: buf, extraHeaders: { 'content-type': contentType } });
  if (!res.ok) throw new Error(`S3 PUT ${key}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return true;
}

export async function getObject(key) {
  const res = await call('GET', key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 GET ${key}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function headObject(key) {
  const res = await call('HEAD', key);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 HEAD ${key}: ${res.status}`);
  return { size: Number(res.headers.get('content-length') || 0), modified: res.headers.get('last-modified') };
}

export async function deleteObject(key) {
  const res = await call('DELETE', key);
  if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${key}: ${res.status}`);
  return true;
}

// Проверка доступа: записать пробный объект, прочитать и удалить.
export async function s3SelfTest() {
  const key = `healthcheck/${Date.now()}.txt`;
  const text = 'ok';
  await putObject(key, text, 'text/plain');
  const back = await getObject(key);
  await deleteObject(key);
  if (!back || back.toString() !== text) throw new Error('Прочитали из хранилища не то, что записали');
  return true;
}
