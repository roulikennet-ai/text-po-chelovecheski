/* ============================================================================
   vkbot.mjs — бот сообщества ВКонтакте через Long Poll API.

   Что делает: по команде в сообщениях сообщества отдаёт отчёт о том,
   кто обрабатывал текст в приложении, в какое время и сколько токенов
   израсходовал.

   Запуск (отдельный процесс, рядом с web-сервером):
     node server/vkbot.mjs

   Секреты берутся только из окружения, app/.env или корневого .env.deploy:
     VK_ACCESS_TOKEN  — ключ сообщества с правами «Сообщения» и «Управление»
     VK_GROUP_ID      — числовой id сообщества
   Токен никогда не печатается в логах и не попадает в ответы.
   ========================================================================== */

import { loadEnvFile } from './gigachat.mjs';
import { clientLabel, getClientReport, getSummary } from './metrics.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* app/.env — приоритет. Если ключа там нет, пробуем корневой .env.deploy
   (тот же файл, что использует docker compose). Уже заданные переменные
   не перезаписываются. */
loadEnvFile();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnvFile(path.join(repoRoot, '.env.deploy'));

loadEnvFile();

const API_VERSION = process.env.VK_API_VERSION || '5.199';
const API_BASE = (process.env.VK_API_BASE || 'https://api.vk.com/method').replace(/\/+$/, '');
const LONGPOLL_BASE = (process.env.VK_LONGPOLL_BASE || '').replace(/\/+$/, '');

const TOKEN = (process.env.VK_ACCESS_TOKEN || '').trim();
const GROUP_ID = (process.env.VK_GROUP_ID || '').trim();
/** Кому разрешено управлять ботом: id пользователей через запятую. Пусто — всем. */
const ADMIN_IDS = (process.env.VK_BOT_ADMINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const WAIT_SECONDS = Number(process.env.VK_LONGPOLL_WAIT) || 25;
const POLL_TIMEOUT_MS = (WAIT_SECONDS + 15) * 1000;

/* ------------------------------ Логи без секретов ------------------------------ */

/** Маскировать возможные токены в тексте ошибки. */
function redact(text) {
  let out = String(text || '');
  if (TOKEN) out = out.split(TOKEN).join('<скрыто>');
  return out.replace(/[A-Za-z0-9_-]{40,}/g, '<скрыто>');
}

function log(...parts) {
  console.log('[vkbot]', ...parts.map((p) => (typeof p === 'string' ? redact(p) : p)));
}

function logError(...parts) {
  console.error('[vkbot]', ...parts.map((p) => (typeof p === 'string' ? redact(p) : p)));
}

/* --------------------------------- VK API --------------------------------- */

async function apiCall(method, params = {}) {
  if (!TOKEN) {
    const err = new Error('VK_ACCESS_TOKEN не задан.');
    err.code = 'no-token';
    throw err;
  }
  const body = new URLSearchParams({ ...params, v: API_VERSION });
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null);
  if (!json) {
    const err = new Error(`VK API ${method}: пустой ответ (${res.status}).`);
    err.code = 'network';
    throw err;
  }
  if (json.error) {
    const vkCode = json.error.error_code;
    const err = new Error(`VK API ${method}: ${json.error.error_msg || 'ошибка'}`);
    err.code = vkCode === 5 ? 'no-token' : 'vk-api';
    err.vkCode = vkCode;
    // Ошибки доступа не пройдут сами: повторять запрос бессмысленно.
    err.fatal = [5, 15, 27, 28, 200, 203].includes(vkCode);
    throw err;
  }
  return json.response;
}

/* -------------------------------- Отчёты --------------------------------- */

const fmtNum = (n) => new Intl.NumberFormat('ru-RU').format(Number(n) || 0);

/** Время в формате «25.11.2026, 18:42» по Москве. */
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Строка «кто — время — токены». */
function requestLine(entry) {
  const who = clientLabel({ id: entry.client?.id, name: entry.client?.name });
  const tokens = fmtNum(entry.usage?.total_tokens);
  const status = entry.ok ? '' : `, ошибка: ${entry.code || 'unknown'}`;
  return `${who} — ${fmtTime(entry.timestamp)} — ${tokens} токенов${status}`;
}

const HELP_TEXT = [
  'Отчёт по обработке текста в приложении «Текст по-человечески».',
  '',
  'Команды:',
  '  report — сводка и последние запросы одним сообщением',
  '  /last — последние 10 запросов: кто, когда, сколько токенов',
  '  /stats — сводка за 7 дней',
  '  /stats 30 — сводка за 30 дней',
  '  /top — расход по пользователям за 7 дней',
  '  /user <id или имя> — детально по одному пользователю',
  '  /help — эта справка',
  '',
  'Команды можно писать со слэшем или без.',
  'Тексты документов не сохраняются: только автор запроса, время и токены.',
].join('\n');

function reportLast() {
  const summary = getSummary(7);
  const rows = summary.last20.slice(0, 10);
  if (!rows.length) return 'За последние 7 дней запросов не было.';
  return ['Последние запросы:', '', ...rows.map((m, i) => `${i + 1}. ${requestLine(m)}`)].join('\n');
}

function reportStats(days) {
  const s = getSummary(days);
  if (!s.total) return `За ${days} дн. запросов не было.`;
  const lines = [
    `Сводка за ${days} дн.:`,
    `Запросов: ${fmtNum(s.total)} (успешно ${fmtNum(s.okCount)}, ошибок ${fmtNum(s.errorCount)})`,
    `Токенов: ${fmtNum(s.tokens.total_tokens)} (prompt ${fmtNum(s.tokens.prompt_tokens)}, completion ${fmtNum(s.tokens.completion_tokens)})`,
  ];
  const models = Object.entries(s.byModel || {});
  if (models.length) {
    lines.push('', 'По моделям:');
    for (const [name, m] of models) {
      lines.push(`  ${name}: ${fmtNum(m.requests)} запр., ${fmtNum(m.tokens)} ток.`);
    }
  }
  return lines.join('\n');
}

/** Отчёт одним сообщением: сводка + последние запросы. */
function reportBrief(days = 7) {
  const s = getSummary(days);
  if (!s.total) return `За ${days} дн. запросов не было.`;
  const rows = s.last20.slice(0, 5);
  const lines = [reportStats(days), '', 'Последние запросы:'];
  for (const m of rows) lines.push(`  ${requestLine(m)}`);
  return lines.join('\n');
}

function reportTop(days = 7) {
  const s = getSummary(days);
  const clients = (s.byClient || []).slice(0, 10);
  if (!clients.length) return `За ${days} дн. запросов не было.`;
  const lines = [`Расход по пользователям за ${days} дн.:`, ''];
  for (const c of clients) {
    lines.push(
      `${clientLabel(c)} — ${fmtNum(c.tokens)} токенов, ${fmtNum(c.requests)} запр., последний ${fmtTime(c.lastAt)}`,
    );
  }
  return lines.join('\n');
}

/** Поиск клиента по id или имени (без учёта регистра). */
function findClient(query) {
  const s = getSummary(90);
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    (s.byClient || []).find((c) => String(c.id).toLowerCase() === q) ||
    (s.byClient || []).find((c) => (c.name || '').toLowerCase() === q) ||
    (s.byClient || []).find((c) => String(c.id).toLowerCase().startsWith(q)) ||
    (s.byClient || []).find((c) => (c.name || '').toLowerCase().includes(q)) ||
    null
  );
}

function reportUser(query) {
  const found = findClient(query);
  if (!found) return `Пользователь «${query}» не найден. Посмотрите /top.`;
  const detail = getClientReport(found.id, { limit: 10 });
  const lines = [
    `Пользователь: ${clientLabel(found)}`,
    `Всего запросов: ${fmtNum(detail.totalRequests)}`,
    `Всего токенов: ${fmtNum(detail.totalTokens)}`,
    `Последний запрос: ${fmtTime(detail.lastAt)}`,
  ];
  if (detail.last.length) {
    lines.push('', 'Последние запросы:');
    for (const m of detail.last) lines.push(`  ${requestLine(m)}`);
  }
  return lines.join('\n');
}

/** Разбор команды. Возвращает текст ответа или null. */
export function buildReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const [cmdRaw, ...rest] = raw.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/^\//, '');
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case 'start':
    case 'help':
    case 'помощь':
      return HELP_TEXT;
    case 'last':
    case 'последние':
      return reportLast();
    case 'report':
    case 'отчет':
    case 'отчёт':
    case 'сводка': {
      const days = Number(arg);
      const n = Number.isFinite(days) && days > 0 ? Math.min(Math.trunc(days), 90) : 7;
      return reportBrief(n);
    }
    case 'stats':
    case 'статистика': {
      const days = Number(arg);
      const n = Number.isFinite(days) && days > 0 ? Math.min(Math.trunc(days), 90) : 7;
      return reportStats(n);
    }
    case 'top':
    case 'топ':
      return reportTop(7);
    case 'user':
    case 'пользователь':
      return arg ? reportUser(arg) : 'Укажите id или имя: /user ivan';
    default:
      return null;
  }
}

/* ------------------------------- Long Poll ------------------------------- */

let stopRequested = false;

async function getLongPollServer() {
  if (!GROUP_ID) {
    const err = new Error('VK_GROUP_ID не задан.');
    err.code = 'no-group';
    throw err;
  }
  const data = await apiCall('groups.getLongPollServer', { group_id: GROUP_ID });
  const server = LONGPOLL_BASE || data.server;
  return { server, key: data.key, ts: data.ts };
}

async function sendMessage(peerId, text) {
  // VK ограничивает длину сообщения: режем по 4000 символов.
  const chunks = [];
  let rest = text;
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf('\n', 4000);
    if (cut < 2000) cut = 4000;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);

  for (const chunk of chunks) {
    try {
      await apiCall('messages.send', {
        peer_id: String(peerId),
        random_id: String(Math.floor(Math.random() * 2 ** 31)),
        message: chunk,
        disable_mentions: '1',
      });
    } catch (err) {
      logError('не удалось отправить сообщение:', err.message);
      return;
    }
  }
}

/** Обработать одно событие Long Poll. */
async function handleEvent(event) {
  if (!event || event.type !== 'message_new') return;
  const msg = event.object?.message;
  if (!msg) return;

  const groupFromId = -Number(GROUP_ID);
  const fromGroup = Number(msg.from_id) === groupFromId;

  // Сообщение от имени сообщества без admin_author_id — это наш собственный
  // ответ (messages.send). Пропускаем, иначе бот зациклится.
  // Если admin_author_id есть, значит писал человек из раздела «Сообщения».
  if (fromGroup && !msg.admin_author_id) return;

  const authorId = msg.admin_author_id || msg.from_id;
  if (!authorId) return;

  if (ADMIN_IDS.length && !ADMIN_IDS.includes(String(authorId))) {
    return;
  }

  const text = msg.text || '';
  const reply = buildReply(text);
  if (!reply) {
    // Содержимое не логируем: в сообщении может быть текст документа.
    if (text.trim()) log(`сообщение без команды (${text.length} симв.), пропущено`);
    return;
  }
  log(`команда от ${authorId}: ${text.split(/\s+/)[0]}`);
  await sendMessage(msg.peer_id || authorId, reply);
}

async function pollLoop() {
  let lp = await getLongPollServer();
  log('Long Poll подключён, ждём сообщения');

  while (!stopRequested) {
    let url;
    try {
      url = `${lp.server}?act=a_check&key=${encodeURIComponent(lp.key)}&ts=${encodeURIComponent(lp.ts)}&wait=${WAIT_SECONDS}`;
    } catch {
      break;
    }

    let data;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
      data = await res.json();
    } catch (err) {
      // Сетевой сбой или таймаут — короткая пауза и повтор.
      logError('опрос прерван:', err?.message || err);
      await sleep(3000);
      continue;
    }

    if (data.failed) {
      // 1 — устарел ts, 2 — устарел key, 3 — устарел сервер.
      log(`Long Poll: failed=${data.failed}, переподключаемся`);
      try {
        if (data.failed === 1 && data.ts) {
          lp.ts = data.ts;
        } else {
          lp = await getLongPollServer();
        }
      } catch (err) {
        logError('не удалось переподключиться:', err.message);
        await sleep(5000);
      }
      continue;
    }

    if (data.ts) lp.ts = data.ts;
    const updates = Array.isArray(data.updates) ? data.updates : [];
    for (const update of updates) {
      try {
        await handleEvent(update);
      } catch (err) {
        logError('ошибка обработки события:', err.message);
      }
    }
  }
  log('остановлен');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* --------------------------------- Запуск -------------------------------- */

async function main() {
  if (!TOKEN) {
    console.error('');
    console.error('  [vkbot] VK_ACCESS_TOKEN не задан — бот не запущен.');
    console.error('  Добавьте ключ сообщества в app/.env (см. VK_BOT.md).');
    console.error('  Ключ в чат присылать не нужно и в логи он не выводится.');
    console.error('');
    process.exitCode = 1;
    return;
  }
  if (!GROUP_ID) {
    console.error('');
    console.error('  [vkbot] VK_GROUP_ID не задан — бот не запущен.');
    console.error('  Укажите числовой id сообщества в app/.env.');
    console.error('');
    process.exitCode = 1;
    return;
  }

  log(`запуск для сообщества ${GROUP_ID}`);
  if (ADMIN_IDS.length) log(`команды принимаются от: ${ADMIN_IDS.join(', ')}`);
  else log('команды принимаются от любого участника сообщества');

  const onSignal = () => {
    stopRequested = true;
    log('получен сигнал остановки');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  // Переподключение при сбоях сети. Ошибки доступа (err.fatal) не повторяем:
  // они не исчезнут без исправления ключа или настроек сообщества.
  for (;;) {
    try {
      await pollLoop();
      break;
    } catch (err) {
      if (err?.fatal) {
        printAccessHelp(err);
        process.exitCode = 1;
        break;
      }
      logError('остановка цикла:', err.message);
      if (stopRequested) break;
      await sleep(10_000);
    }
  }
}

/** Понятное объяснение, если VK отказал в доступе. */
function printAccessHelp(err) {
  console.error('');
  console.error(`  [vkbot] VK отклонил запрос (код ${err.vkCode ?? '—'}): ${err.message}`);
  console.error('');
  console.error('  Скорее всего у ключа нет нужных прав. Проверьте:');
  console.error('  1) Ключ создан как «Ключ доступа сообщества», а не сервисный');
  console.error('     и не ключ пользователя: Управление → Настройки → Работа с API.');
  console.error('  2) В ключе отмечены права «Сообщения сообщества» и');
  console.error('     «Управление сообществом» (messages + manage).');
  console.error('     Права groups/stats для Long Poll недостаточны.');
  console.error('  3) В том же разделе включён Long Poll API (версия 5.199+),');
  console.error('     отмечено событие «Входящее сообщение».');
  console.error('  4) В сообществе включены «Сообщения сообщества».');
  console.error('');
  console.error('  После исправления обновите VK_ACCESS_TOKEN в app/.env');
  console.error('  или .env.deploy и перезапустите бота. Подробнее: VK_BOT.md');
  console.error('');
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isEntryPoint() || process.env.VK_BOT_FORCE_MAIN === '1') {
  main().catch((err) => {
    logError('непредвиденная ошибка:', err?.message || err);
    process.exitCode = 1;
  });
}
