/* ============================================================================
   api.mjs — HTTP-обработчик GigaChat-прокси. Один и тот же код работает
   в dev (через плагин Vite) и в проде (server/index.mjs).
   Ключ авторизации живёт только здесь; браузер его не видит.
   ========================================================================== */

import crypto from 'node:crypto';
import { CHAT_MODELS, DEFAULT_MODEL, DEFAULT_SCOPE, chat, isConfigured, keySource, listModels, trustAnchorsInstalled } from './gigachat.mjs';
import { getSummary, recordMetric } from './metrics.mjs';
import { getCommunityInfo, vkStatus, isVkConfigured, handleCallback } from './vk.mjs';
import { handleAccounts } from './accounts.mjs';

const MAX_BODY_BYTES = 512 * 1024;

/** Токен администратора для доступа к сводке (только из env, не из браузера). */
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();

/** Сравнение токенов без утечки по времени. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Идентификатор клиента для отчётов. Разрешены только буквы, цифры,
 * дефис и подчёркивание: это защищает от подстановки произвольного текста
 * (и от попадания персональных данных) в файл метрик.
 */
function sanitizeClientId(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned || null;
}

/** Отображаемое имя: обрезаем и убираем управляющие символы. */
function sanitizeClientName(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || null;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/** Прочитать тело запроса с ограничением размера. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Тело запроса слишком большое.'), { code: 'too-large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Некорректный JSON в теле запроса.'), { code: 'bad-json' }));
      }
    });
    req.on('error', reject);
  });
}

/** Ошибка движка → HTTP-ответ с человеческим сообщением (без секретов). */
function sendEngineError(res, err) {
  const statusByCode = { 'no-key': 401, quota: 429, 'bad-request': 400, 'too-large': 413, 'bad-json': 400 };
  const status = statusByCode[err.code] || 502;
  const messages = {
    'no-key': 'Ключ авторизации GigaChat не принят или не задан на сервере.',
    quota: 'GigaChat ограничил частоту запросов. Попробуйте позже.',
    'bad-request': 'Некорректный запрос к серверу.',
    'too-large': 'Слишком большой фрагмент текста для одного запроса.',
    'bad-json': 'Некорректный JSON в теле запроса.',
    network: 'Не удалось связаться с GigaChat. Проверьте интернет.',
    unknown: 'GigaChat вернул неожиданный ответ.',
  };
  sendJson(res, status, {
    ok: false,
    code: err.code || 'unknown',
    error: messages[err.code] || messages.unknown,
    detail: typeof err.detail === 'string' ? err.detail : undefined,
  });
}

/* --------------------------------- Маршруты --------------------------------- */

async function handleStatus(res) {
  sendJson(res, 200, {
    ok: true,
    configured: isConfigured(),
    keySource: keySource(),
    trustAnchors: trustAnchorsInstalled,
    defaultModel: DEFAULT_MODEL,
    scope: DEFAULT_SCOPE,
    chatModels: CHAT_MODELS,
  });
}

async function handleModels(res, signal) {
  if (!isConfigured()) {
    return sendJson(res, 401, { ok: false, code: 'no-key', error: 'Ключ авторизации GigaChat не задан на сервере.' });
  }
  const ids = await listModels({ signal });
  sendJson(res, 200, { ok: true, models: ids, chatModels: ids.filter((id) => CHAT_MODELS.includes(id)) });
}

async function handleChat(res, body, signal) {
  const { system, user, model, temperature, maxTokens } = body || {};
  if (typeof system !== 'string' || typeof user !== 'string' || !system.trim() || !user.trim()) {
    return sendJson(res, 400, { ok: false, code: 'bad-request', error: 'Нужны поля system и user.' });
  }
  const started = Date.now();
  const chosenModel = typeof model === 'string' && model ? model : DEFAULT_MODEL;
  // В метрики попадает только длина текста, сам текст не сохраняется.
  const textChars = system.length + user.length;
  // Кто израсходовал токены: анонимный ID установки и необязательное имя.
  const clientId = sanitizeClientId(body?.clientId);
  const clientName = sanitizeClientName(body?.clientName);

  try {
    const result = await chat({
      system,
      user,
      model: chosenModel,
      temperature: typeof temperature === 'number' && Number.isFinite(temperature) ? Math.min(Math.max(temperature, 0), 1.2) : 0.35,
      maxTokens: typeof maxTokens === 'number' && Number.isFinite(maxTokens) ? Math.min(Math.max(Math.trunc(maxTokens), 32), 4096) : 1600,
      signal,
    });
    const usage = result.usage || {};
    recordMetric({
      model: result.model || chosenModel,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      elapsedMs: Date.now() - started,
      ok: true,
      textChars,
      clientId,
      clientName,
    });
    sendJson(res, 200, {
      ok: true,
      content: result.content,
      model: result.model,
      usage: result.usage,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    recordMetric({
      model: chosenModel,
      elapsedMs: Date.now() - started,
      ok: false,
      code: err?.code || 'unknown',
      textChars,
      clientId,
      clientName,
    });
    throw err;
  }
}

/* --------------------------------- Админ-сводка --------------------------------- */

/**
 * GET /api/admin/stats?days=7 — сводка запросов и расхода токенов.
 * Доступ только по Bearer-токену из ADMIN_TOKEN. Тексты документов
 * в метриках не хранятся: только модель, usage, время и длина в символах.
 */
async function handleAdminStats(req, res, url) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!ADMIN_TOKEN) {
    return sendJson(res, 503, {
      ok: false,
      code: 'no-admin-token',
      error: 'ADMIN_TOKEN не задан на сервере — сводка недоступна.',
    });
  }
  const header = String(req.headers['authorization'] || '');
  const provided = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!provided || !safeEqual(provided, ADMIN_TOKEN)) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized', error: 'Нужен токен администратора.' });
  }

  let days = 7;
  try {
    const parsed = new URL(url || '/', 'http://localhost').searchParams.get('days');
    const n = Number(parsed);
    if (Number.isFinite(n) && n > 0) days = Math.min(Math.max(Math.trunc(n), 1), 90);
  } catch {
    /* оставляем 7 дней */
  }

  sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), ...getSummary(days) });
}

/**
 * GET /api/admin/vk — сведения о сообществе ВКонтакте.
 * Доступ по тому же ADMIN_TOKEN.
 */
async function handleAdminVk(req, res) {
  if (!ADMIN_TOKEN) {
    return sendJson(res, 503, { ok: false, error: 'ADMIN_TOKEN не задан.' });
  }
  const header = String(req.headers['authorization'] || '');
  const provided = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!provided || !safeEqual(provided, ADMIN_TOKEN)) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized', error: 'Нужен токен администратора.' });
  }

  const status = vkStatus();
  if (!isVkConfigured()) {
    return sendJson(res, 200, { ok: true, configured: false, status });
  }

  try {
    const info = await getCommunityInfo();
    sendJson(res, 200, { ok: true, configured: true, status, info });
  } catch (err) {
    sendJson(res, 200, {
      ok: false,
      configured: true,
      status,
      error: err?.code === 'no-vk-token'
        ? 'Токен сообщества ВКонтакте не задан или отозван.'
        : `VK API ошибка: ${err?.detail || err.message}`,
    });
  }
}

/**
 * POST /api/vk/callback — Callback API для сообщества ВКонтакте.
 * Принимает события от VK, возвращает подтверждение.
 * Если секрет задан, проверяет совпадение поля secret.
 */
async function handleVkCallback(req, res) {
  const body = await readBody(req);
  const secret = typeof body.secret === 'string' ? body.secret : '';
  const event = typeof body === 'object' && body !== null ? body : {};
  const result = handleCallback(event, { secret });
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(result.body);
}

/**
 * Главная точка входа. Возвращает true, если запрос обработан здесь.
 * Пути: /api/gigachat/<action> и /api/admin/stats.
 */
export async function handleApi(req, res, { url = req.url } = {}) {
  const pathname = (url || '').split('?')[0];

  // Учётные записи: регистрация, вход, личный кабинет.
  // Тексты документов здесь не принимаются и не сохраняются.
  if (pathname === '/api/account' || pathname.startsWith('/api/account/')) {
    await handleAccounts(req, res, { url });
    return true;
  }

  if (pathname === '/api/admin/stats') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return true;
    }
    await handleAdminStats(req, res, url);
    return true;
  }

  if (pathname === '/api/admin/vk') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return true;
    }
    await handleAdminVk(req, res);
    return true;
  }

  if (pathname === '/api/vk/callback') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      return true;
    }
    await handleVkCallback(req, res);
    return true;
  }

  if (!pathname.startsWith('/api/gigachat')) return false;

  // Локальный прокси: никакого CORS-соседства с чужими страницами.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const controller = new AbortController();
  // Отменяем только при реальном обрыве соединения клиентом.
  // 'close' на req срабатывает и после штатного чтения тела — это не обрыв.
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  try {
    const action = pathname.slice('/api/gigachat'.length).replace(/^\/+/, '');

    if (req.method === 'GET' && (action === '' || action === 'status')) {
      await handleStatus(res);
      return true;
    }
    if (req.method === 'POST' && action === 'models') {
      await handleModels(res, controller.signal);
      return true;
    }
    if (req.method === 'POST' && action === 'chat') {
      const body = await readBody(req);
      await handleChat(res, body, controller.signal);
      return true;
    }

    sendJson(res, 404, { ok: false, error: 'Неизвестный маршрут GigaChat-прокси.' });
    return true;
  } catch (err) {
    sendEngineError(res, err);
    return true;
  } finally {
    res.off('close', onClose);
  }
}

/** Мини-middleware в стиле connect (Vite) — для dev-режима. */
export function gigachatMiddleware() {
  return (req, res, next) => {
    handleApi(req, res)
      .then((handled) => {
        if (!handled && typeof next === 'function') next();
      })
      .catch((err) => {
        if (typeof next === 'function') next(err);
        else sendEngineError(res, err);
      });
  };
}
