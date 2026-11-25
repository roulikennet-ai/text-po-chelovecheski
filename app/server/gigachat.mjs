/* ============================================================================
   gigachat.mjs — клиент GigaChat API для серверной части (web-версия).
   Ключ авторизации читается только здесь, на сервере: из переменной
   окружения GIGACHAT_AUTH_KEY, из app/.env или из файла GIGACHAT_KEY_FILE.
   Ключ никогда не логируется и никогда не отдаётся в браузер.
   ========================================================================== */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

/* ------------------------------ .env (без зависимостей) ------------------------------ */

/** Простейший парсер .env: KEY=VALUE, комментарии через #. */
export function loadEnvFile(file = path.join(appRoot, '.env')) {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

/* --------------------------------- Настройки --------------------------------- */

const OAUTH_URL = process.env.GIGACHAT_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_BASE = (process.env.GIGACHAT_API_BASE || 'https://api.giga.chat/v1').replace(/\/+$/, '');
export const DEFAULT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
export const DEFAULT_MODEL = process.env.GIGACHAT_MODEL || 'GigaChat-2';
export const ALLOWED_SCOPES = ['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'];

/** Разрешённые модели чата (эмбеддинги не подходят для переписывания). */
export const CHAT_MODELS = [
  'GigaChat-2',
  'GigaChat-2-Pro',
  'GigaChat-2-Max',
  'GigaChat-3-Lightning',
  'GigaChat-3-Pro',
  'GigaChat-3-Ultra',
];

/* ------------------------- Доверенные сертификаты НУЦ Минцифры ------------------------- */

/**
 * api.giga.chat и OAuth-хост подписаны цепочкой Russian Trusted Root CA,
 * которой обычно нет в хранилище Windows. Подкладываем её в стандартный
 * набор Node, чтобы TLS проходил без правки системных настроек.
 */
function installRussianTrustAnchors() {
  const files = ['russian-trusted-root-ca.pem', 'russian-trusted-sub-ca.pem'];
  const extra = [];
  for (const name of files) {
    try {
      extra.push(fs.readFileSync(path.join(here, 'certs', name), 'utf8'));
    } catch {
      /* сертификат не обязателен, если он уже есть в системе */
    }
  }
  if (extra.length === 0) return false;
  try {
    if (typeof tls.setDefaultCACertificates === 'function') {
      tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...extra]);
      return true;
    }
  } catch {
    /* молча продолжаем: возможно, сертификат уже доверенный */
  }
  return false;
}

export const trustAnchorsInstalled = installRussianTrustAnchors();

/* ------------------------------ Ключ авторизации ------------------------------ */

/** Путь к файлу с ключом, если ключ не задан переменной окружения. */
const keyFile = process.env.GIGACHAT_KEY_FILE
  ? path.resolve(process.env.GIGACHAT_KEY_FILE)
  : path.resolve(appRoot, '..', 'API', 'api.txt');

/** Найти ключ авторизации. Возвращает строку или пустую строку. */
export function readAuthKey() {
  const fromEnv = (process.env.GIGACHAT_AUTH_KEY || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(keyFile, 'utf8').trim();
    if (fromFile) return fromFile;
  } catch {
    /* файла нет — это нормально */
  }
  return '';
}

export function isConfigured() {
  return readAuthKey().length > 0;
}

/** Откуда взят ключ — для честного статуса в интерфейсе (без самого ключа). */
export function keySource() {
  if ((process.env.GIGACHAT_AUTH_KEY || '').trim()) return 'env';
  try {
    if (fs.readFileSync(keyFile, 'utf8').trim()) return 'file';
  } catch {
    /* нет файла */
  }
  return 'none';
}

/* -------------------------------- Токен доступа -------------------------------- */

let tokenCache = { value: '', expiresAt: 0 };

/** Получить access_token по ключу авторизации (OAuth 2.0, срок жизни 30 минут). */
export async function getAccessToken({ force = false, signal } = {}) {
  const authKey = readAuthKey();
  if (!authKey) {
    const err = new Error('Ключ авторизации GigaChat не задан на сервере.');
    err.code = 'no-key';
    throw err;
  }
  const now = Date.now();
  if (!force && tokenCache.value && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.value;
  }

  const body = new URLSearchParams({ scope: DEFAULT_SCOPE }).toString();
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: crypto.randomUUID(),
      Authorization: `Basic ${authKey}`,
    },
    body,
    signal,
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`OAuth GigaChat вернул ${res.status}.`);
    err.code = res.status === 401 || res.status === 403 ? 'no-key' : 'network';
    err.detail = text.slice(0, 200);
    throw err;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error('OAuth GigaChat вернул неожиданный ответ.');
    err.code = 'network';
    throw err;
  }
  if (!json.access_token) {
    const err = new Error('OAuth GigaChat не вернул access_token.');
    err.code = 'network';
    throw err;
  }

  // expires_at приходит в миллисекундах; страхуемся, если пришло в секундах.
  let expiresAt = Number(json.expires_at) || 0;
  if (expiresAt > 0 && expiresAt < 1e12) expiresAt *= 1000;
  tokenCache = { value: json.access_token, expiresAt: expiresAt || now + 25 * 60_000 };
  return tokenCache.value;
}

/* ---------------------------------- Запросы ---------------------------------- */

async function callChat(payload, { signal, token } = {}) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* не JSON */
  }
  return { res, text, json };
}

/**
 * Переписать текст: один запрос к чат-модели.
 * Возвращает { content, model, usage }.
 */
export async function chat({ system, user, model = DEFAULT_MODEL, temperature = 0.35, maxTokens = 1600, signal }) {
  if (!system || !user) {
    const err = new Error('Нужны system и user промпты.');
    err.code = 'bad-request';
    throw err;
  }
  const chosenModel = CHAT_MODELS.includes(model) ? model : DEFAULT_MODEL;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const payload = { model: chosenModel, messages, temperature, max_tokens: maxTokens };

  let token = await getAccessToken({ signal });
  let out = await callChat(payload, { signal, token });

  // Протухший токен — один прозрачный повтор.
  if (out.res.status === 401 || out.res.status === 403) {
    tokenCache = { value: '', expiresAt: 0 };
    token = await getAccessToken({ force: true, signal });
    out = await callChat(payload, { signal, token });
  }

  if (!out.res.ok) {
    const err = new Error(`GigaChat вернул ${out.res.status}.`);
    err.code = out.res.status === 429 ? 'quota' : out.res.status === 401 || out.res.status === 403 ? 'no-key' : 'network';
    err.detail = (out.json?.message || out.text || '').slice(0, 200);
    throw err;
  }

  const content = out.json?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) {
    const err = new Error('GigaChat вернул пустой ответ.');
    err.code = 'unknown';
    throw err;
  }
  return {
    content: String(content).trim(),
    model: out.json?.model || chosenModel,
    usage: out.json?.usage || null,
  };
}

/** Список доступных моделей (для проверки подключения в интерфейсе). */
export async function listModels({ signal } = {}) {
  const token = await getAccessToken({ signal });
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) {
    const err = new Error(`Список моделей недоступен (${res.status}).`);
    err.code = 'network';
    throw err;
  }
  const json = await res.json();
  const ids = Array.isArray(json?.data) ? json.data.map((m) => m.id).filter(Boolean) : [];
  return ids;
}
