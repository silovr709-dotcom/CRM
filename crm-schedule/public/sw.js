/* Офлайн-режим: оболочка приложения из кэша, данные и так лежат в браузере.
 * Стратегия: навигация — сначала сеть (чтобы обновления приходили сразу),
 * ассеты с хэшем в имени — из кэша, остальное — «кэш + фоновое обновление». */

const VERSION = 'crm-v3';
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

async function fromCacheOrNetwork(request) {
  const cache = await caches.open(CORE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        const copy = response.clone();
        cache.put('./index.html', copy);
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Переходы по страницам: свежий index, при отсутствии сети — из кэша.
  if (request.mode === 'navigate') {
    event.respondWith(fromCacheOrNetwork(request));
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
