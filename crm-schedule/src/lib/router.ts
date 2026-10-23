// Адресные ссылки на разделы и карточки: #/crm, #/deal/<id>, #/client/<id>.
// Хэш-роутинг работает и на статическом хостинге, и в файле, и в PWA.
import { useEffect, useState } from 'react';

export type ViewId = 'overview' | 'crm' | 'schedule' | 'tasks' | 'data';

export interface Route {
  view: ViewId;
  dealId?: string;
  clientId?: string;
  /** ?new=deal | client | install */
  create?: 'deal' | 'client' | 'install';
  /** Принять сделку из ссылки: #/share/<payload>. */
  share?: string;
  /** Подключиться к общей базе: #/sync/<code>. */
  sync?: string;
  /** Вкладка карточки сделки. */
  tab?: string;
}

const VIEWS: ViewId[] = ['overview', 'crm', 'schedule', 'tasks', 'data'];

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = clean.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart ?? '');

  const create = query.get('new');
  const tab = query.get('tab') ?? undefined;
  const base: Route = {
    view: 'overview',
    create: create === 'deal' || create === 'client' || create === 'install' ? create : undefined,
    tab: tab || undefined,
  };

  if (segments.length === 0) return base;
  if (segments[0] === 'share' && segments[1]) return { ...base, share: decodeURIComponent(segments[1]) };
  if (segments[0] === 'sync' && segments[1]) return { ...base, view: 'data', sync: decodeURIComponent(segments[1]) };
  if (segments[0] === 'deal' && segments[1]) return { ...base, view: 'crm', dealId: decodeURIComponent(segments[1]) };
  if (segments[0] === 'client' && segments[1]) return { ...base, view: 'crm', clientId: decodeURIComponent(segments[1]) };
  if (VIEWS.includes(segments[0] as ViewId)) {
    const view = segments[0] as ViewId;
    if (view === 'crm' && segments[1] === 'clients') return { ...base, view, create: base.create };
    return { ...base, view };
  }
  return base;
}

export function buildHash(route: Route): string {
  let path = `#/${route.view}`;
  if (route.dealId) path = `#/deal/${encodeURIComponent(route.dealId)}`;
  else if (route.clientId) path = `#/client/${encodeURIComponent(route.clientId)}`;
  else if (route.share) path = `#/share/${encodeURIComponent(route.share)}`;
  else if (route.sync) path = `#/sync/${encodeURIComponent(route.sync)}`;

  const query = new URLSearchParams();
  if (route.create) query.set('new', route.create);
  if (route.tab) query.set('tab', route.tab);
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

/** Текущий маршрут; навигация меняет хэш, работает кнопка «назад». */
export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(route: Route, options: { replace?: boolean; keepScroll?: boolean } = {}) {
  const next = buildHash(route);
  if (window.location.hash === next) return;
  if (options.replace) window.history.replaceState(null, '', next);
  else window.history.pushState(null, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  if (!options.keepScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Ссылка для отправки коллеге. */
export function absoluteLink(route: Route): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${buildHash(route)}`;
}
