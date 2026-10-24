import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Дата сборки видна в «Данных»: по ней понятно, свежая ли версия открыта.
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: { host: '0.0.0.0', port: 5173, strictPort: false, allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  base: './',
});
