/* ============================================================================
   index.mjs — web-сервер: раздаёт собранный фронтенд (dist/) и проксирует
   запросы к GigaChat. Запуск: npm run web
   Порт: PORT (по умолчанию 4173).
   ========================================================================== */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.mjs';
import { DEFAULT_MODEL, DEFAULT_SCOPE, isConfigured, keySource, trustAnchorsInstalled } from './gigachat.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const distDir = path.join(appRoot, 'dist');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

/** Безопасно отдать файл из dist/: запрет выхода за пределы каталога. */
function serveStatic(req, res, pathname) {
  if (!fs.existsSync(distDir)) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Сборка не найдена. Выполните: npm run build');
    return;
  }

  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(distDir, relative);
  const inside = target === distDir || target.startsWith(distDir + path.sep);

  const file = inside && fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(distDir, 'index.html');

  fs.readFile(file, (err, data) => {
    if (err) {
      res.statusCode = 500;
      res.end('Не удалось прочитать файл сборки.');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.end(data);
  });
}

/** Отдать страницу админ-сводки (сам токен запрашивается уже в браузере). */
function serveAdmin(res) {
  fs.readFile(path.join(here, 'admin.html'), (err, data) => {
    if (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Страница админ-сводки не найдена.');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  const pathname = (req.url || '/').split('?')[0];
  if ((pathname === '/admin' || pathname === '/admin/') && (req.method === 'GET' || req.method === 'HEAD')) {
    serveAdmin(res);
    return;
  }
  handleApi(req, res)
    .then((handled) => {
      if (handled) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }
      serveStatic(req, res, pathname);
    })
    .catch((err) => {
      console.error('[web] ошибка запроса:', err?.message || err);
      if (!res.headersSent) res.statusCode = 500;
      res.end('Внутренняя ошибка сервера.');
    });
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('  Текст по-человечески — web-версия');
  console.log(`  Открыть: ${url}`);
  console.log(`  GigaChat: ${isConfigured() ? `ключ найден (${keySource() === 'env' ? 'переменная окружения' : 'файл'})` : 'КЛЮЧ НЕ ЗАДАН'}`);
  console.log(`  Модель: ${DEFAULT_MODEL} · scope: ${DEFAULT_SCOPE}`);
  console.log(`  Сертификаты НУЦ Минцифры: ${trustAnchorsInstalled ? 'подключены' : 'из системного хранилища'}`);
  console.log(`  Админ-сводка: ${process.env.ADMIN_TOKEN ? `${url}/admin` : 'ADMIN_TOKEN не задан'}`);
  console.log(`  Аккаунты: ${process.env.ADMIN_EMAIL ? `уведомления → ${process.env.ADMIN_EMAIL}` : 'ADMIN_EMAIL не задан (уведомления в data/notifications.jsonl)'}`);
  console.log('');
  if (!isConfigured()) {
    console.log('  Ключ не найден. Добавьте его одним из способов:');
    console.log('   1) app/.env            → GIGACHAT_AUTH_KEY=<ключ авторизации>');
    console.log('   2) переменная окружения GIGACHAT_AUTH_KEY');
    console.log('   3) файл API/api.txt (как сейчас)');
    console.log('');
  }
});
