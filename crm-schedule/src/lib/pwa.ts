// Установка на телефон и офлайн-режим: манифест + service worker.
// В dev-режиме service worker не регистрируем, иначе HMR отдаёт старые файлы.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: InstallPromptEvent | null = null;
const availabilityListeners = new Set<(available: boolean) => void>();

function announce() {
  const available = Boolean(deferredPrompt);
  availabilityListeners.forEach((listener) => listener(available));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Своя кнопка «Установить» вместо баннера браузера.
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    announce();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    announce();
  });
}

/** Приложение уже открыто как установленное (без адресной строки). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  if (navigatorStandalone) return true;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  return false;
}

/** Можно ли предложить установку — и подписка на изменение этого флага. */
export function installAvailable(): boolean {
  return Boolean(deferredPrompt);
}

export function onInstallAvailability(listener: (available: boolean) => void): () => void {
  availabilityListeners.add(listener);
  listener(Boolean(deferredPrompt));
  return () => { availabilityListeners.delete(listener); };
}

/** Показывает системное окно установки. true — пользователь согласился. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      deferredPrompt = null;
      announce();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Слежение за сетью: плашка «нет соединения». */
export function watchOnline(listener: (online: boolean) => void): () => void {
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  listener(window.navigator.onLine !== false);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

export interface ServiceWorkerOptions {
  /** Появилась новая версия — предложить обновление. */
  onUpdateReady: () => void;
}

/** Регистрирует service worker и следит за обновлениями. */
export function registerServiceWorker(options: ServiceWorkerOptions): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  if (!import.meta.env.PROD) return () => {};

  let reloading = false;
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.getRegistration().then((value) => value?.update().catch(() => {})).catch(() => {});
  };

  const handleUpdate = (worker: ServiceWorker | null) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) options.onUpdateReady();
    });
  };

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((value) => {
      handleUpdate(value.installing);
      value.addEventListener('updatefound', () => handleUpdate(value.installing));
      // Проверяем обновления при возврате к приложению.
      document.addEventListener('visibilitychange', onVisible);
    })
    .catch(() => {
      /* офлайн-кэш не критичен: приложение продолжит работать онлайн */
    });

  const onControllerChange = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

  return () => {
    navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Активирует ожидающий service worker — после этого страница перезагрузится. */
export async function applyUpdate(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

/**
 * Принудительное обновление: проверяем новую версию, активируем её и чистим
 * кэш. Нужно, когда приложение открыто со старой сборкой (частый случай на
 * телефоне: «изменений не видно»).
 */
export async function forceUpdate(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.update();
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      const installing = registration.installing;
      if (installing) {
        await new Promise<void>((resolve) => {
          installing.addEventListener('statechange', () => {
            if (installing.state === 'activated' || installing.state === 'redundant') resolve();
          });
        });
      }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* сервис-воркер мог быть не зарегистрирован — просто перезагрузим */
  }
  window.location.reload();
}

/** Дата сборки, вшитая при сборке (dev — текущий момент). */
export function buildDate(): string {
  const stamp = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
  return stamp || new Date().toISOString();
}
