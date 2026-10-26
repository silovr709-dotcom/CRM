/* Офлайн-режим: оболочка приложения из кэша, данные и так лежат в браузере.
 * Стратегия: навигация — сначала сеть (чтобы обновления приходили сразу),
 * ассеты с хэшем в имени — из кэша, остальное — «кэш + фоновое обновление».
 *
 * v4: навигация раньше брала index из кэша, а свежую копию клала под другим
 * ключом ('./index.html' вместо './'), поэтому установленное приложение
 * навсегда оставалось на старой версии — новых разделов было не видно. */

// При смене стратегии кэширования поднимайте версию: старые кэши сотрутся.
const VERSION = 'crm-v4';
const CORE = `crm-core-${VERSION}`;
const RUNTIME = `crm-runtime-${VERSION}`;

const CORE_ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE);
    // Отдельные файлы кэшируем по одному: один промах не должен ломать установку.
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch {
        /* пропускаем: возможно, файла нет в этой сборке */
      }
    }));
    // Новая версия не ждёт, пока закроют все вкладки: активируется сразу,
    // а страница сама перезагрузится по событию controllerchange.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CORE && key !== RUNTIME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function navigationFromNetwork(request) {
  const cache = await caches.open(CORE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Кладём свежую оболочку под тем же ключом, под которым её запросили,
      // и под './index.html' — чтобы офлайн-запуск находил её по любому пути.
      await cache.put(request, response.clone());
      await cache.put('./index.html', response.clone());
    }
    return response;
  } catch {
    // Нет сети — отдаём последнюю загруженную оболочку.
    const cached = (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match('./index.html'))
      || (await cache.match('./'));
    if (cached) return cached;
    throw new Error('Нет сети и нет сохранённой версии приложения');
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Переходы по страницам: свежий index, при отсутствии сети — из кэша.
  if (request.mode === 'navigate') {
    event.respondWith(navigationFromNetwork(request));
    return;
  }

  // Хэшированные файлы сборки не меняются — их можно отдавать сразу из кэша.
  const isHashed = /\/assets\/.+-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|png|svg)$/.test(url.pathname);
  if (isHashed) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(RUNTIME).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => cached);
    return cached || network;
  })());
});
