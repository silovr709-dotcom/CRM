/* Офлайн-режим: оболочка приложения из кэша, данные и так лежат в браузере.
 * Стратегия: навигация — сначала сеть (чтобы обновления приходили сразу),
 * ассеты с хэшем в имени — из кэша, остальное — «кэш + фоновое обновление».
 *
 * v4: навигация раньше брала index из кэша, а свежую копию клала под другим
 * ключом ('./index.html' вместо './'), поэтому установленное приложение
 * навсегда оставалось на старой версии — новых разделов было не видно.
 * v5: ответы PHP-API больше не проходят через кэш service worker: запросы
 * входа и базы зависят от заголовков/cookie, а cache.match их не различает. */

// При смене стратегии кэширования поднимайте версию: старые кэши сотрутся.
// v7: при установке предкэшируем все чанки сборки по манифесту Vite,
// чтобы офлайн сразу работал весь, а не только уже открытые разделы.
const VERSION = 'crm-v7';
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

async function precacheBuildAssets(cache) {
  // По манифесту Vite собираем все файлы сборки: входной чанк, стили,
  // ленивые чанки (PDF, OCR) и их зависимости — рекурсивно по imports.
  const urls = new Set();
  try {
    const response = await fetch('./.vite/manifest.json', { cache: 'reload' });
    if (response.ok) {
      const manifest = await response.json();
      const visit = (key, seen) => {
        if (!key || seen.has(key)) return;
        seen.add(key);
        const entry = manifest[key];
        if (!entry) return;
        if (entry.file) urls.add(`./${entry.file}`);
        for (const css of entry.css ?? []) urls.add(`./${css}`);
        for (const asset of entry.assets ?? []) urls.add(`./${asset}`);
        for (const dep of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) visit(dep, seen);
      };
      for (const key of Object.keys(manifest)) visit(key, new Set());
    }
  } catch {
    /* манифеста нет (старая сборка) — обойдёмся оболочкой */
  }
  if (urls.size === 0) {
    // Запасной путь: вытащить ассеты прямо из index.html.
    try {
      const html = await (await fetch('./index.html', { cache: 'reload' })).text();
      for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) urls.add(match[1]);
    } catch {
      /* и это не вышло — останутся runtime-кэши */
    }
  }
  await Promise.all([...urls].map(async (url) => {
    try {
      await cache.add(new Request(url, { cache: 'reload' }));
    } catch {
      /* один битый файл не ломает установку */
    }
  }));
}

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
    await precacheBuildAssets(cache);
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

// Клик по уведомлению (в том числе по сработавшему из локального расписания,
// когда приложение было закрыто): поднять открытую вкладку или открыть приложение.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow('./');
  })());
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
  // API не кэшируем и не подменяем: вход, роли и база всегда идут в сеть.
  if (url.pathname.includes('/api/')) return;

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
