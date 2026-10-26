import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Регрессия: установленное на телефон приложение не видело новых разделов
// (например, «Склад»). Старый service worker отдавал навигации страницу из
// кэша, а свежую копию клал под другим ключом — оболочка не обновлялась никогда.
const sw = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

function section(from: string, to: string): string {
  const start = sw.indexOf(from);
  expect(start, `нет фрагмента ${from}`).toBeGreaterThanOrEqual(0);
  const end = sw.indexOf(to, start);
  expect(end, `нет конца фрагмента ${to}`).toBeGreaterThan(start);
  return sw.slice(start, end);
}

describe('обновление установленного приложения', () => {
  it('версия кэша поднята — старые кэши сотрутся при активации', () => {
    expect(sw).toContain("const VERSION = 'crm-v4'");
    expect(section("self.addEventListener('activate'", "self.addEventListener('message'")).toContain('caches.delete');
  });

  it('новая версия активируется сразу, не ожидая закрытия вкладок', () => {
    expect(section("self.addEventListener('install'", "self.addEventListener('activate'")).toContain('self.skipWaiting()');
  });

  it('навигация сначала идёт в сеть, а не в кэш', () => {
    const navigation = section('async function navigationFromNetwork', "self.addEventListener('fetch'");
    expect(navigation.indexOf('await fetch(request)')).toBeGreaterThanOrEqual(0);
    // Свежая оболочка сохраняется под тем же ключом, под которым запрошена.
    expect(navigation).toContain('cache.put(request,');
    expect(navigation).toContain("cache.put('./index.html'");
    // Кэш — только запасной путь при отсутствии сети (внутри catch).
    expect(navigation.indexOf('cache.match')).toBeGreaterThan(navigation.indexOf('catch'));
    expect(navigation).not.toContain('return cached || network');
  });

  it('обработчик переходов использует сетевую стратегию', () => {
    expect(sw).toContain('event.respondWith(navigationFromNetwork(request))');
  });
});
