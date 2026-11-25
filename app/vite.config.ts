import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { gigachatMiddleware } from './server/api.mjs';

/**
 * Плагин отдаёт /api/gigachat/* в dev-режиме тем же кодом, что и прод-сервер.
 * Ключ GigaChat читается на сервере из .env / переменной окружения.
 */
function gigachatProxy(): Plugin {
  return {
    name: 'gigachat-proxy',
    configureServer(server) {
      server.middlewares.use(gigachatMiddleware());
    },
  };
}

// База './' — чтобы сборка открывалась из Tauri (file://) без сервера.
export default defineConfig({
  base: './',
  plugins: [react(), gigachatProxy()],
  server: {
    port: 5173,
    strictPort: false,
    // Браузер открывается сам на фактическом порту — запуск одним действием.
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    outDir: 'dist',
    target: 'chrome110',
    sourcemap: false,
  },
});
