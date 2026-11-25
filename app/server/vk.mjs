/* ============================================================================
   vk.mjs — интеграция с сообществом ВКонтакте.

   Что делает:
   1. Читает статистику сообщества через VK API (groups.getById, stats.get).
   2. Принимает события Callback API (подтверждение сервера, новые подписчики).

   Секреты живут только на сервере:
   - VK_ACCESS_TOKEN — токен сообщества (права: groups, stats)
   - VK_GROUP_ID     — числовой id сообщества (без минуса)
   - VK_GROUP_SCREEN — короткое имя, например "text_by_human"
   - VK_CONFIRMATION_TOKEN — строка подтверждения из настроек Callback API
   - VK_SECRET       — секретный ключ Callback API (проверка подлинности)

   Без токена модуль работает в режиме «не настроено» и не падает.
   ========================================================================== */

const API_VERSION = process.env.VK_API_VERSION || '5.199';
const API_BASE = 'https://api.vk.com/method';

const ACCESS_TOKEN = (process.env.VK_ACCESS_TOKEN || '').trim();
const GROUP_ID = (process.env.VK_GROUP_ID || '').trim();
const GROUP_SCREEN = (process.env.VK_GROUP_SCREEN || '').trim();
const CONFIRMATION_TOKEN = (process.env.VK_CONFIRMATION_TOKEN || '').trim();
const CALLBACK_SECRET = (process.env.VK_SECRET || '').trim();

export function isVkConfigured() {
  return ACCESS_TOKEN.length > 0;
}

/** Что настроено — для честного статуса в интерфейсе (без самих секретов). */
export function vkStatus() {
  return {
    configured: isVkConfigured(),
    hasGroupId: GROUP_ID.length > 0,
    hasScreenName: GROUP_SCREEN.length > 0,
    callbackReady: CONFIRMATION_TOKEN.length > 0,
    secretSet: CALLBACK_SECRET.length > 0,
  };
}

/**
 * Вызов метода VK API. Токен передаётся в заголовке Authorization,
 * чтобы не светить его в URL и логах прокси.
 */
async function vkCall(method, params = {}, { signal } = {}) {
  if (!ACCESS_TOKEN) {
    const err = new Error('Токен сообщества ВКонтакте не задан на сервере.');
    err.code = 'no-vk-token';
    throw err;
  }
  const body = new URLSearchParams({ ...params, v: API_VERSION });
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body,
    signal,
  });
  const json = await res.json().catch(() => null);
  if (json?.error) {
    const err = new Error(json.error.error_msg || 'Ошибка VK API.');
    err.code = json.error.error_code === 5 ? 'no-vk-token' : 'vk-api';
    err.detail = `code ${json.error.error_code}`;
    throw err;
  }
  if (!res.ok || !json) {
    const err = new Error(`VK API вернул ${res.status}.`);
    err.code = 'network';
    throw err;
  }
  return json.response;
}

/**
 * Сведения о сообществе: подписчики, описание, ссылка.
 * Плюс статистика посещений за период, если у токена есть право stats.
 */
export async function getCommunityInfo({ signal } = {}) {
  const identifier = GROUP_ID || GROUP_SCREEN;
  if (!identifier) {
    const err = new Error('Не задан VK_GROUP_ID или VK_GROUP_SCREEN.');
    err.code = 'vk-no-group';
    throw err;
  }

  const groups = await vkCall(
    'groups.getById',
    { group_id: identifier, fields: 'members_count,description,status,photo_100,screen_name' },
    { signal },
  );
  const group = Array.isArray(groups) ? groups[0] : groups?.groups?.[0];
  if (!group) {
    const err = new Error('Сообщество ВКонтакте не найдено.');
    err.code = 'vk-no-group';
    throw err;
  }

  let stats = null;
  try {
    const raw = await vkCall(
      'stats.get',
      {
        group_id: group.id,
        interval: 'week',
        intervals_count: 1,
        extended: 1,
      },
      { signal },
    );
    const block = Array.isArray(raw) ? raw[0] : null;
    if (block) {
      const pick = (name) => {
        const item = (block.activity || []).find((a) => a.name === name);
        return item ? Number(item.value) || 0 : 0;
      };
      const visitors = (block.visitors || []).reduce((sum, v) => sum + (Number(v.value) || 0), 0);
      stats = {
        periodFrom: block.period_from ? new Date(block.period_from * 1000).toISOString() : null,
        periodTo: block.period_to ? new Date(block.period_to * 1000).toISOString() : null,
        views: pick('views'),
        visitors,
        reachSubscribers: pick('reach_subscribers'),
        likes: pick('likes'),
        comments: pick('comments'),
        reposts: pick('reposts'),
        subscribers: (block.activity || []).find((a) => a.name === 'subscribed')?.value ?? null,
      };
    }
  } catch (err) {
    // Права stats может не быть — это не повод ломать сводку.
    stats = { error: err?.code === 'no-vk-token' ? 'no-vk-token' : 'unavailable' };
  }

  return {
    id: group.id,
    name: group.name,
    screenName: group.screen_name || GROUP_SCREEN || null,
    url: `https://vk.com/${group.screen_name || GROUP_SCREEN || `club${group.id}`}`,
    membersCount: Number(group.members_count) || 0,
    description: (group.description || '').slice(0, 300),
    photo: group.photo_100 || null,
    stats,
  };
}

/**
 * Обработка события Callback API.
 * Возвращает { status, body } — что отправить обратно VK.
 */
export function handleCallback(event, { secret } = {}) {
  if (!event || typeof event !== 'object') {
    return { status: 400, body: 'bad request' };
  }
  // Если секрет задан — VK обязан прислать совпадающее поле.
  if (CALLBACK_SECRET && secret !== CALLBACK_SECRET) {
    return { status: 403, body: 'forbidden' };
  }
  if (event.type === 'confirmation') {
    if (!CONFIRMATION_TOKEN) {
      return { status: 503, body: 'confirmation token not configured' };
    }
    return { status: 200, body: CONFIRMATION_TOKEN };
  }
  // Остальные события подтверждаем, чтобы VK не отключал сервер.
  return { status: 200, body: 'ok' };
}
