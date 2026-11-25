/* ============================================================================
   accounts.mjs — простая регистрация, вход и личный кабинет.

   Что хранится на сервере: имя, адрес электронной почты, необратимый хеш
   пароля, дата регистрации и факт согласия. Тексты документов сюда не
   попадают: проекты остаются в браузере пользователя.

   Файл данных: app/data/users.json (переопределяется USERS_FILE).
   Уведомления о регистрации: app/data/notifications.jsonl (JSON Lines).
   ========================================================================== */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClientUsage } from './metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

const USERS_FILE = process.env.USERS_FILE
  ? path.resolve(process.env.USERS_FILE)
  : path.resolve(appRoot, 'data', 'users.json');

const NOTIFY_FILE = process.env.NOTIFY_FILE
  ? path.resolve(process.env.NOTIFY_FILE)
  : path.resolve(appRoot, 'data', 'notifications.jsonl');

/** Версия текста согласия: форма обязана прислать ровно её. */
export const CONSENT_VERSION = '2026-11-25';

const SESSION_TTL_MS = 30 * 86400000;
const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;

/** Текст, который пользователь подтверждает галочкой (не отмечена заранее). */
const CONSENT_TEXT =
  'Я согласен на обработку моих персональных данных (имя и адрес электронной почты) ' +
  'для создания учётной записи и доступа к личному кабинету. Согласие можно отозвать, удалив аккаунт.';

/* ------------------------------- Хранилище ------------------------------- */

function emptyStore() {
  return { version: 1, users: [], sessions: [] };
}

function readStore() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.users) || !Array.isArray(parsed.sessions)) return emptyStore();
    const now = Date.now();
    // Просроченные сессии не держим: срок жизни ограничен.
    parsed.sessions = parsed.sessions.filter((s) => Number(s.expiresAt) > now);
    return parsed;
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${USERS_FILE}.tmp.${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, USERS_FILE);
}

/** Записать уведомление администратору. Только факт, без текстов документов. */
function notify(entry) {
  try {
    const dir = path.dirname(NOTIFY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(NOTIFY_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn('[accounts] не удалось записать уведомление:', err?.message || err);
  }
}

/* --------------------------------- Утилиты -------------------------------- */

function adminEmail() {
  return String(process.env.ADMIN_EMAIL || '').trim();
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

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
        reject(Object.assign(new Error('Некорректный JSON.'), { code: 'bad-json' }));
      }
    });
    req.on('error', reject);
  });
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  if (email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return '';
  return email;
}

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) return '';
  return name;
}

function sanitizeClientId(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned || null;
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt);
  return { algo: 'scrypt', salt, hash: key.toString('hex') };
}

async function verifyPassword(password, record) {
  if (!record || record.algo !== 'scrypt' || !record.salt || !record.hash) return false;
  const key = await scrypt(password, record.salt);
  const expected = Buffer.from(record.hash, 'hex');
  if (expected.length !== key.length) return false;
  return crypto.timingSafeEqual(expected, key);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    consentAt: user.consent?.at || null,
    consentVersion: user.consent?.version || null,
    clientIds: Array.isArray(user.clientIds) ? user.clientIds : [],
  };
}

function bearerToken(req) {
  const header = String(req.headers['authorization'] || '');
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

function sessionUser(store, req) {
  const token = bearerToken(req);
  if (!token) return null;
  const session = store.sessions.find((s) => s.token === token && Number(s.expiresAt) > Date.now());
  if (!session) return null;
  const user = store.users.find((u) => u.id === session.userId);
  return user ? { user, session } : null;
}

/** Привязать анонимный ID установки к аккаунту (для статистики кабинета). */
function attachClientId(user, clientId) {
  const id = sanitizeClientId(clientId);
  if (!id) return;
  if (!Array.isArray(user.clientIds)) user.clientIds = [];
  if (!user.clientIds.includes(id)) user.clientIds.push(id);
}

/* --------------------------- Ограничение попыток -------------------------- */

/** Неудачные входы: ключ «email|ip» → { count, resetAt }. Живёт в памяти. */
const loginFails = new Map();

function loginKey(req, email) {
  const ip = req.socket?.remoteAddress || 'unknown';
  return `${email}|${ip}`;
}

function isRateLimited(key) {
  const rec = loginFails.get(key);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) {
    loginFails.delete(key);
    return false;
  }
  return rec.count >= LOGIN_MAX_FAILS;
}

function noteFail(key) {
  const now = Date.now();
  const rec = loginFails.get(key);
  if (!rec || now > rec.resetAt) {
    loginFails.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    rec.count += 1;
  }
}

function clearFails(key) {
  loginFails.delete(key);
}

/* --------------------------------- Маршруты ------------------------------- */

async function handleMeta(res) {
  const email = adminEmail();
  sendJson(res, 200, {
    ok: true,
    consentVersion: CONSENT_VERSION,
    consentText: CONSENT_TEXT,
    adminEmail: email || null,
    notice: {
      purpose: 'Форма создаёт учётную запись в этой установке приложения «Текст по-человечески».',
      dataUse:
        'Имя и адрес электронной почты нужны для входа и подписи в личном кабинете. ' +
        'Пароль хранится только как необратимый хеш. Тексты документов остаются на вашем устройстве ' +
        'и на сервер не передаются.',
      recipient: email
        ? `Уведомление о регистрации получает администратор установки: ${email}.`
        : 'Уведомление о регистрации получает администратор этой установки (адрес ADMIN_EMAIL не задан).',
      retention:
        'Данные хранятся, пока существует аккаунт. Удаление аккаунта стирает имя, адрес, хеш пароля и сессии.',
    },
  });
}

async function handleRegister(req, res) {
  const body = await readBody(req);

  // Согласие должно быть явным: true, а не «по умолчанию».
  if (body?.consent !== true) {
    return sendJson(res, 400, {
      ok: false,
      code: 'no-consent',
      error: 'Нужно явное согласие на обработку персональных данных. Отметьте галочку в форме.',
    });
  }
  if (body?.consentVersion && body.consentVersion !== CONSENT_VERSION) {
    return sendJson(res, 409, {
      ok: false,
      code: 'consent-version',
      error: 'Текст согласия обновился. Перезагрузите страницу и подтвердите согласие заново.',
    });
  }

  const name = normalizeName(body?.name);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!name) {
    return sendJson(res, 400, { ok: false, code: 'bad-name', error: 'Укажите имя от 2 до 60 символов.' });
  }
  if (!email) {
    return sendJson(res, 400, { ok: false, code: 'bad-email', error: 'Укажите корректный адрес электронной почты.' });
  }
  if (password.length < 8 || password.length > 200) {
    return sendJson(res, 400, { ok: false, code: 'bad-password', error: 'Пароль должен быть от 8 до 200 символов.' });
  }

  const store = readStore();
  if (store.users.some((u) => u.email === email)) {
    return sendJson(res, 409, {
      ok: false,
      code: 'email-taken',
      error: 'Аккаунт с таким адресом уже существует. Войдите или укажите другой адрес.',
    });
  }

  const now = new Date().toISOString();
  const user = {
    id: `u_${crypto.randomBytes(8).toString('hex')}`,
    name,
    email,
    password: await hashPassword(password),
    createdAt: now,
    lastLoginAt: now,
    consent: { given: true, at: now, version: CONSENT_VERSION, text: CONSENT_TEXT },
    clientIds: [],
  };
  attachClientId(user, body?.clientId);
  store.users.push(user);

  const token = crypto.randomBytes(32).toString('hex');
  store.sessions.push({
    token,
    userId: user.id,
    createdAt: now,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  writeStore(store);

  const recipient = adminEmail() || null;
  notify({
    type: 'register',
    at: now,
    userId: user.id,
    name: user.name,
    email: user.email,
    recipient,
    consentVersion: CONSENT_VERSION,
  });
  console.log(`[accounts] регистрация: ${user.name} <${user.email}> → уведомление ${recipient || 'администратору установки'}`);

  sendJson(res, 201, {
    ok: true,
    token,
    expiresAt: Date.now() + SESSION_TTL_MS,
    user: publicUser(user),
    stats: getClientUsage(user.clientIds),
  });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return sendJson(res, 400, { ok: false, code: 'bad-request', error: 'Укажите адрес и пароль.' });
  }

  const key = loginKey(req, email);
  if (isRateLimited(key)) {
    return sendJson(res, 429, {
      ok: false,
      code: 'rate-limited',
      error: 'Слишком много попыток входа. Подождите 15 минут и попробуйте снова.',
    });
  }

  const store = readStore();
  const user = store.users.find((u) => u.email === email);
  const valid = user ? await verifyPassword(password, user.password) : false;
  if (!user || !valid) {
    noteFail(key);
    return sendJson(res, 401, { ok: false, code: 'invalid-credentials', error: 'Неверный адрес или пароль.' });
  }
  clearFails(key);

  const now = new Date().toISOString();
  user.lastLoginAt = now;
  attachClientId(user, body?.clientId);

  const token = crypto.randomBytes(32).toString('hex');
  store.sessions.push({
    token,
    userId: user.id,
    createdAt: now,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  writeStore(store);

  sendJson(res, 200, {
    ok: true,
    token,
    expiresAt: Date.now() + SESSION_TTL_MS,
    user: publicUser(user),
    stats: getClientUsage(user.clientIds),
  });
}

async function handleLogout(req, res) {
  const store = readStore();
  const found = sessionUser(store, req);
  if (found) {
    store.sessions = store.sessions.filter((s) => s.token !== found.session.token);
    writeStore(store);
  }
  sendJson(res, 200, { ok: true });
}

async function handleMe(req, res) {
  const store = readStore();
  const found = sessionUser(store, req);
  if (!found) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized', error: 'Нужен вход в аккаунт.' });
  }
  sendJson(res, 200, {
    ok: true,
    user: publicUser(found.user),
    stats: getClientUsage(found.user.clientIds),
  });
}

async function handleProfile(req, res) {
  const body = await readBody(req);
  const store = readStore();
  const found = sessionUser(store, req);
  if (!found) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized', error: 'Нужен вход в аккаунт.' });
  }

  if (body?.name !== undefined) {
    const name = normalizeName(body.name);
    if (!name) {
      return sendJson(res, 400, { ok: false, code: 'bad-name', error: 'Имя должно быть от 2 до 60 символов.' });
    }
    found.user.name = name;
  }
  if (body?.clientId !== undefined) attachClientId(found.user, body.clientId);
  writeStore(store);

  sendJson(res, 200, {
    ok: true,
    user: publicUser(found.user),
    stats: getClientUsage(found.user.clientIds),
  });
}

async function handleDelete(req, res) {
  const body = await readBody(req);
  const store = readStore();
  const found = sessionUser(store, req);
  if (!found) {
    return sendJson(res, 401, { ok: false, code: 'unauthorized', error: 'Нужен вход в аккаунт.' });
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  if (!(await verifyPassword(password, found.user.password))) {
    return sendJson(res, 403, { ok: false, code: 'invalid-credentials', error: 'Пароль не совпадает.' });
  }

  const removed = found.user;
  store.users = store.users.filter((u) => u.id !== removed.id);
  store.sessions = store.sessions.filter((s) => s.userId !== removed.id);
  writeStore(store);

  notify({
    type: 'delete',
    at: new Date().toISOString(),
    userId: removed.id,
    name: removed.name,
    email: removed.email,
    recipient: adminEmail() || null,
  });
  console.log(`[accounts] аккаунт удалён: ${removed.name} <${removed.email}>`);

  sendJson(res, 200, { ok: true });
}

/* ------------------------------- Точка входа ------------------------------ */

/**
 * Обработать /api/account/*. Возвращает true, если маршрут наш.
 * Публичные: meta, register, login. Остальные требуют Bearer-токен.
 */
export async function handleAccounts(req, res, { url = req.url } = {}) {
  const pathname = (url || '').split('?')[0];
  if (!pathname.startsWith('/api/account')) return false;

  const action = pathname.slice('/api/account'.length).replace(/^\/+/, '');
  const method = req.method || 'GET';

  try {
    if (action === 'meta' && (method === 'GET' || method === 'HEAD')) {
      await handleMeta(res);
      return true;
    }
    if (action === 'register' && method === 'POST') {
      await handleRegister(req, res);
      return true;
    }
    if (action === 'login' && method === 'POST') {
      await handleLogin(req, res);
      return true;
    }
    if (action === 'logout' && method === 'POST') {
      await handleLogout(req, res);
      return true;
    }
    if ((action === 'me' || action === '') && (method === 'GET' || method === 'HEAD')) {
      await handleMe(req, res);
      return true;
    }
    if (action === 'profile' && (method === 'PUT' || method === 'PATCH')) {
      await handleProfile(req, res);
      return true;
    }
    if ((action === '' || action === 'delete') && method === 'DELETE') {
      await handleDelete(req, res);
      return true;
    }

    sendJson(res, 404, { ok: false, code: 'not-found', error: 'Неизвестный маршрут аккаунта.' });
    return true;
  } catch (err) {
    if (err?.code === 'too-large' || err?.code === 'bad-json') {
      sendJson(res, 400, { ok: false, code: err.code, error: 'Некорректный запрос.' });
      return true;
    }
    console.error('[accounts] ошибка:', err?.message || err);
    sendJson(res, 500, { ok: false, code: 'server', error: 'Внутренняя ошибка учётной записи.' });
    return true;
  }
}
