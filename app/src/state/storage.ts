/* ============================================================================
   storage.ts — локальное хранилище (FR-SEC-1): проекты, профиль стиля,
   настройки, журнал. В Tauri заменяется на SQLite за тем же интерфейсом.
   ========================================================================== */

import type { AppSettings, AuditEvent, Project, StyleProfile } from '../core/types';

const NS = 'tph.v1';
const KEY_PROJECTS = `${NS}.projects`;
const KEY_CURRENT = `${NS}.currentProjectId`;
const KEY_SETTINGS = `${NS}.settings`;
const KEY_AUDIT = `${NS}.audit`;
const KEY_PROFILE = `${NS}.styleProfile`;
const KEY_DICT = `${NS}.dictionary`;
const KEY_CONSENT = `${NS}.consent`;
/** Максимум записей журнала (ротация по размеру, ТЗ §4.7). */
const AUDIT_LIMIT = 1000;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Переполнение квоты — не роняем приложение.
    console.warn('Не удалось сохранить данные локально', e);
  }
}

/* ------------------------------- Проекты -------------------------------- */

export function loadProjects(): Project[] {
  return read<Project[]>(KEY_PROJECTS, []);
}

export function saveProjects(projects: Project[]): void {
  write(KEY_PROJECTS, projects);
}

export function loadCurrentProjectId(): string | null {
  return read<string | null>(KEY_CURRENT, null);
}

export function saveCurrentProjectId(id: string | null): void {
  write(KEY_CURRENT, id);
}

/* ------------------------------ Настройки ------------------------------- */

export const DEFAULT_SETTINGS: AppSettings = {
  engine: 'local',
  cloudModel: 'GigaChat-2',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  cloudProvider: 'gigachat',
  gigachatProxyUrl: '/api/gigachat',
  localEngine: 'rules',
  localModelUrl: '',
  localModelPath: '',
  cloudAllowed: true,
  cloudConsentGiven: false,
  docFontSize: 17,
  weeklyLimitPages: 100,
  pagesThisWeek: 0,
  weekAnchor: weekKey(new Date()),
  darkMode: false,
  userName: '',
  clientId: '',
};

/** Анонимный ID установки: не содержит персональных данных. */
function newClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* старый браузер без randomUUID */
  }
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function weekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/* GigaChat-модели: если провайдер GigaChat, но модель не из списка — сервер
   заменит её на DEFAULT_MODEL. Здесь приводим к известной, чтобы не вводить
   пользователя в заблуждение. */
const GIGACHAT_MODELS = [
  'GigaChat-2', 'GigaChat-2-Pro', 'GigaChat-2-Max',
  'GigaChat-3-Lightning', 'GigaChat-3-Pro', 'GigaChat-3-Ultra',
];

export function loadSettings(): AppSettings {
  const stored = read<Partial<AppSettings>>(KEY_SETTINGS, {});
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  // Сброс недельного счётчика при смене недели.
  const currentWeek = weekKey(new Date());
  if (merged.weekAnchor !== currentWeek) {
    merged.weekAnchor = currentWeek;
    merged.pagesThisWeek = 0;
  }
  /* Миграция: если провайдер GigaChat, а модель неизвестна — заменить на дефолт. */
  if (merged.cloudProvider === 'gigachat' && !GIGACHAT_MODELS.includes(merged.cloudModel)) {
    merged.cloudModel = DEFAULT_SETTINGS.cloudModel;
  }
  /* Идентификатор установки нужен для отчётов: создаём один раз и сохраняем. */
  if (!merged.clientId) {
    merged.clientId = newClientId();
    write(KEY_SETTINGS, merged);
  }
  return merged;
}

export function saveSettings(settings: AppSettings): void {
  write(KEY_SETTINGS, settings);
}

/* -------------------------------- Журнал -------------------------------- */

export function loadAudit(): AuditEvent[] {
  return read<AuditEvent[]>(KEY_AUDIT, []);
}

export function saveAudit(events: AuditEvent[]): void {
  const trimmed = events.slice(-AUDIT_LIMIT);
  write(KEY_AUDIT, trimmed);
}

export function clearAudit(): void {
  write(KEY_AUDIT, []);
}

/* ---------------------------- Профиль стиля ----------------------------- */

export function loadStyleProfile(): StyleProfile | null {
  return read<StyleProfile | null>(KEY_PROFILE, null);
}

export function saveStyleProfile(profile: StyleProfile | null): void {
  write(KEY_PROFILE, profile);
}

/* --------------------------- Словарь терминов --------------------------- */

export function loadDictionary(): string[] {
  return read<string[]>(KEY_DICT, []);
}

export function saveDictionary(terms: string[]): void {
  write(KEY_DICT, terms);
}

/* ------------------------- Согласие на облако --------------------------- */

export function loadCloudConsent(): boolean {
  return read<boolean>(KEY_CONSENT, false);
}

export function saveCloudConsent(v: boolean): void {
  write(KEY_CONSENT, v);
}

/** Разовое согласие: живёт до закрытия вкладки (FR-SEC-2, M1). */
const KEY_CONSENT_SESSION = `${NS}.cloudConsentSession`;

export function loadSessionConsent(): boolean {
  try {
    return sessionStorage.getItem(KEY_CONSENT_SESSION) === '1';
  } catch {
    return false;
  }
}

export function saveSessionConsent(v: boolean): void {
  try {
    if (v) sessionStorage.setItem(KEY_CONSENT_SESSION, '1');
    else sessionStorage.removeItem(KEY_CONSENT_SESSION);
  } catch {
    /* ignore */
  }
}

/* ------------------------------ Утилиты --------------------------------- */

/** Полная очистка всех данных приложения (для «Сбросить всё»). */
export function wipeAll(): void {
  for (const key of [KEY_PROJECTS, KEY_CURRENT, KEY_SETTINGS, KEY_AUDIT, KEY_PROFILE, KEY_DICT, KEY_CONSENT]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** Приблизительный размер хранилища, КБ. */
export function storageSizeKb(): number {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(NS)) continue;
    total += (localStorage.getItem(key)?.length ?? 0) * 2;
  }
  return Math.round(total / 1024);
}

export { KEY_AUDIT };

