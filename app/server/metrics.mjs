/* ============================================================================
   metrics.mjs — учёт запросов и расхода токенов GigaChat.
   Записывает метаданные после каждого chat-запроса (без текста документа!).
   Хранит JSON-файл с последовательными записями.
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

/* Путь к файлу метрик (по умолчанию app/data/metrics.json). */
const METRICS_FILE = process.env.METRICS_FILE
  ? path.resolve(process.env.METRICS_FILE)
  : path.resolve(appRoot, 'data', 'metrics.json');

/* ---------- Чтение существующих метрик ---------- */

/** Считать массив метрик из файла. Возвращает []. */
function readMetrics() {
  try {
    const raw = fs.readFileSync(METRICS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** Записать массив метрик в файл (атомарно: temp + rename). */
function writeMetrics(metrics) {
  const dir = path.dirname(METRICS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = METRICS_FILE + '.tmp.' + crypto.randomUUID();
  fs.writeFileSync(tmp, JSON.stringify(metrics, null, 2), 'utf8');
  fs.renameSync(tmp, METRICS_FILE);
}

/* ---------- Запись одной записи ---------- */

/**
 * Записать метрику запроса.
 * @param {Object} data
 * @param {string} data.model   — имя модели
 * @param {number} data.promptTokens — prompt_tokens из GigaChat
 * @param {number} data.completionTokens — completion_tokens из GigaChat
 * @param {number} data.elapsedMs — время ответа в мс
 * @param {boolean} data.ok — true если запрос успешен
 * @param {string} [data.code] — код ошибки (quota, network, no-key…)
 * @param {number} [data.textChars] — длина отправленного текста в символах
 * @param {string} [data.clientId] — анонимный ID установки
 * @param {string} [data.clientName] — имя, указанное пользователем (необязательно)
 */
export function recordMetric({
  model,
  promptTokens,
  completionTokens,
  elapsedMs,
  ok,
  code,
  textChars,
  clientId,
  clientName,
}) {
  const metrics = readMetrics();
  metrics.push({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    model: model || 'unknown',
    client: {
      id: clientId || null,
      name: clientName || null,
    },
    usage: {
      prompt_tokens: Number(promptTokens) || 0,
      completion_tokens: Number(completionTokens) || 0,
      total_tokens: (Number(promptTokens) || 0) + (Number(completionTokens) || 0),
    },
    elapsedMs: Number(elapsedMs) || 0,
    ok: Boolean(ok),
    code: code || null,
    textChars: Number(textChars) || 0,
  });
  writeMetrics(metrics);
}

/* ---------- Агрегация ---------- */

/**
 * Разбивка расхода по пользователям за период.
 * Ключ — clientId; имя берётся из последней записи с непустым именем.
 */
function aggregateByClient(recent) {
  /** @type {Record<string, { id, name, requests, tokens, ok, error, lastAt }>} */
  const by = {};
  for (const m of recent) {
    const id = m.client?.id || 'без-id';
    const name = m.client?.name || '';
    const acc = by[id] || { id, name: '', requests: 0, tokens: 0, ok: 0, error: 0, lastAt: '' };
    acc.requests += 1;
    acc.tokens += m.usage?.total_tokens || 0;
    if (m.ok) acc.ok += 1; else acc.error += 1;
    if (name) acc.name = name;
    if (m.timestamp > acc.lastAt) acc.lastAt = m.timestamp;
    by[id] = acc;
  }
  return Object.values(by).sort((a, b) => b.tokens - a.tokens);
}

/** Человеческое имя клиента для отчётов. */
export function clientLabel(entry) {
  if (entry?.name) return entry.name;
  const id = entry?.id || 'без-id';
  return id === 'без-id' ? 'без имени' : `ID ${id.slice(0, 8)}`;
}

/**
 * Получить сводку за N дней (по умолчанию 7).
 * @param {number} [days=7]
 * @returns {{ total, okCount, errorCount, tokens, byModel, last20 }}
 */
export function getSummary(days = 7) {
  const metrics = readMetrics();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  // Сортируем по времени: порядок в файле не гарантирован.
  const recent = metrics
    .filter((m) => m.timestamp >= cutoff)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const total = recent.length;
  const okCount = recent.filter((m) => m.ok).length;
  const errorCount = total - okCount;
  const tokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const byModel = /** @type {Record<string, { requests: number; tokens: number; ok: number; error: number; ms: number }> } */ ({});

  for (const m of recent) {
    tokens.prompt_tokens += m.usage.prompt_tokens;
    tokens.completion_tokens += m.usage.completion_tokens;
    tokens.total_tokens += m.usage.total_tokens;

    const by = byModel[m.model] || { requests: 0, tokens: 0, ok: 0, error: 0, ms: 0 };
    by.requests += 1;
    by.tokens += m.usage.total_tokens;
    if (m.ok) by.ok += 1; else by.error += 1;
    by.ms += m.elapsedMs;
    byModel[m.model] = by;
  }

  return {
    periodDays: days,
    total,
    okCount,
    errorCount,
    tokens,
    byModel,
    byClient: aggregateByClient(recent),
    last20: recent.slice(-20).reverse(),
  };
}

/**
 * Расход по набору идентификаторов установки (личный кабинет).
 * Тексты документов не читаются: только счётчики из метрик.
 * @param {string[]} clientIds
 */
export function getClientUsage(clientIds = []) {
  const ids = new Set((clientIds || []).filter(Boolean));
  if (ids.size === 0) {
    return { requests: 0, ok: 0, error: 0, tokens: 0, lastAt: null, byModel: {} };
  }
  const metrics = readMetrics();
  const own = metrics.filter((m) => ids.has(m.client?.id));
  const tokens = own.reduce((s, m) => s + (m.usage?.total_tokens || 0), 0);
  const ok = own.filter((m) => m.ok).length;
  const byModel = {};
  for (const m of own) {
    const acc = byModel[m.model] || { requests: 0, tokens: 0 };
    acc.requests += 1;
    acc.tokens += m.usage?.total_tokens || 0;
    byModel[m.model] = acc;
  }
  const lastAt = own.length
    ? own.reduce((max, m) => (String(m.timestamp) > String(max) ? m.timestamp : max), '')
    : null;
  return { requests: own.length, ok, error: own.length - ok, tokens, lastAt, byModel };
}

/** Последние N записей по конкретному клиенту (для ответов бота). */
export function getClientReport(clientId, { limit = 10 } = {}) {
  const metrics = readMetrics();
  const own = metrics
    .filter((m) => (m.client?.id || 'без-id') === clientId)
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const totalTokens = own.reduce((s, m) => s + (m.usage?.total_tokens || 0), 0);
  const last = own.slice(-limit).reverse();
  return {
    clientId,
    totalRequests: own.length,
    totalTokens,
    lastAt: own.length ? own[own.length - 1].timestamp : null,
    last,
  };
}
