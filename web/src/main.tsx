import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA: офлайн-оболочка и установка на телефон
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Ловим системное предложение установки (Chrome/Edge/Android) —
// покажем свою кнопку «Установить приложение» в настройках.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).__installPrompt = e;
  window.dispatchEvent(new Event('pwa-installable'));
});
window.addEventListener('appinstalled', () => {
  (window as any).__installPrompt = null;
  window.dispatchEvent(new Event('pwa-installable'));
});
