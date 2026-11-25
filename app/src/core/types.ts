/* ============================================================================
   types.ts — доменные типы приложения (ТЗ §6.1).
   ========================================================================== */

/** Режим подачи (F1–F4), ТЗ §5.1. */
export type PresetId = 'F1' | 'F2' | 'F3' | 'F4';

/** Уровень интенсивности правок (1–5), ТЗ §5.2. */
export type Intensity = 1 | 2 | 3 | 4 | 5;

/** Целевое сжатие для F2. */
export type CompressTarget = 15 | 30 | 50;

/** Движок: облако или локальная модель (FR-8.3.1). */
export type EngineKind = 'cloud' | 'local';

/** Статус абзаца (ТЗ §6.1). */
export type ParagraphStatus =
  | 'original'
  | 'pending'
  | 'processed'
  | 'accepted'
  | 'rejected'
  | 'warning'
  | 'error';

/** Класс защиты фрагмента (ТЗ §4.5). */
export type ProtectionClass = 'number' | 'name' | 'abbr' | 'latin' | 'url' | 'ref' | 'manual' | 'dictionary';

/** Защищённый фрагмент с позицией в исходном тексте. */
export interface ProtectedSpan {
  /** Текст фрагмента дословно. */
  text: string;
  /** Смещение начала в исходном абзаце. */
  start: number;
  /** Смещение конца (исключая). */
  end: number;
  /** Класс защиты. */
  cls: ProtectionClass;
  /** Токен-заглушка, которой фрагмент заменялся при генерации. */
  token: string;
}

/** Результат проверки смысла по абзацу (FR-7.x). */
export interface SenseCheck {
  /** 🟢 | 🟡 | 🔴 */
  level: 'ok' | 'warn' | 'bad';
  /** Всего извлечено единиц смысла. */
  found: number;
  /** Сколько единиц сохранено. */
  kept: number;
  /** Пояснения к проблемам. */
  issues: SenseIssue[];
}

export interface SenseIssue {
  kind:
    | 'lost-number'
    | 'lost-name'
    | 'lost-ref'
    | 'added-fact'
    | 'strength-changed'
    | 'cliche'
    | 'new-list'
    | 'register'
    | 'broken-grammar'
    | 'longer';
  message: string;
  detail?: string;
}

/** Метрики человечности (ТЗ §10.1). */
export interface HumanMetrics {
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  h5: number;
  total: number;
}

/** Вариант переписывания (FR-5.1). */
export interface Variant {
  id: string;
  text: string;
  /** Подпись отличия: «ближе к исходному», «короче», «больше связности». */
  label: string;
  sense?: SenseCheck;
}

/** Абзац проекта (ТЗ §6.1). */
export interface Paragraph {
  id: string;
  /** Текст исходный. */
  original: string;
  /** Текст текущий (после принятых правок). */
  current: string;
  /** Варианты от последнего запуска. */
  variants: Variant[];
  /** Статус. */
  status: ParagraphStatus;
  /** Защищённые фрагменты. */
  protectedSpans: ProtectedSpan[];
  /** Результат проверки смысла. */
  sense?: SenseCheck;
  /** Тип блока из DOCX (для сохранения структуры при экспорте). */
  blockKind: 'heading' | 'paragraph' | 'list-item' | 'quote';
  /** Уровень заголовка 1–9 (для heading). */
  headingLevel?: number;
  /** Отступ списка. */
  listLevel?: number;
  /** Нумерованный ли список (F3 раскрывает только маркированные). */
  ordered?: boolean;
  /** Принят ли абзац (для быстрой фильтрации). */
  accepted?: boolean;
}

/** Снимок версии (FR-10.2). */
export interface Version {
  id: string;
  createdAt: number;
  /** Причина снимка. */
  reason: 'launch' | 'export' | 'rollback' | 'manual';
  /** Полный текст на момент снимка. */
  paragraphs: Array<Pick<Paragraph, 'id' | 'original' | 'current' | 'status' | 'blockKind' | 'headingLevel'>>;
  label: string;
}

/** Событие журнала (ТЗ §4.7). */
export interface AuditEvent {
  id: string;
  at: number;
  event:
    | 'import'
    | 'batch-start'
    | 'batch-stop'
    | 'spot-start'
    | 'accept'
    | 'reject'
    | 'accept-all'
    | 'reject-all'
    | 'protection-change'
    | 'style-profile-change'
    | 'export'
    | 'error'
    | 'rollback'
    | 'settings';
  object: string;
  engine: EngineKind | '—';
  param: string;
  result: string;
}

/** Проект (ТЗ §6.1). */
export interface Project {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  paragraphs: Paragraph[];
  versions: Version[];
  /** Настройки последнего запуска. */
  settings: RunSettings;
  /** Имя исходного файла, если импорт из DOCX. */
  sourceFileName?: string;
  /** Исходный DOCX (base64) — неизменяемый эталон, если был импорт. */
  sourceDocxBase64?: string;
}

export interface RunSettings {
  preset: PresetId;
  intensity: Intensity;
  compressTarget: CompressTarget;
  engine: EngineKind;
  model: string;
}

/** Профиль стиля (ТЗ §6.1, FR-8.x). */
export interface StyleProfile {
  /** Исходные тексты, из которых построен профиль. */
  sources: Array<{ id: string; title: string; chars: number; addedAt: number }>;
  avgSentenceLength: number;
  complexShare: number;
  /** Топ слов-маркеров. */
  topWords: Array<{ word: string; count: number }>;
  /** Частотные вводные конструкции. */
  introPhrases: string[];
  /** Средняя длина предложения — целевой диапазон. */
  targetRange: [number, number];
  builtAt: number;
}

/** Настройки приложения (E10). */
/** Облачный провайдер: OpenAI-совместимый API или GigaChat через прокси. */
export type CloudProvider = 'openai' | 'gigachat';

/** Локальный движок: встроенные правила или скачанная GGUF-модель. */
export type LocalEngineKind = 'rules' | 'gguf';

export interface AppSettings {
  engine: EngineKind;
  cloudModel: string;
  apiBaseUrl: string;
  /**
   * Ключ хранится локально; в UI маскируется.
   * Для GigaChat не используется: ключ авторизации живёт только на сервере
   * (server/.env), в браузер не попадает.
   */
  apiKey: string;
  /** Какой облачный провайдер использовать. */
  cloudProvider: CloudProvider;
  /** Адрес локального прокси GigaChat. */
  gigachatProxyUrl: string;
  /** Локальный движок: правила или GGUF-модель. */
  localEngine: LocalEngineKind;
  /** Адрес GGUF-файла для локальной модели. */
  localModelUrl: string;
  localModelPath: string;
  cloudAllowed: boolean;
  /** Показывать ли M1 при каждом облачном запуске (false = «постоянно разрешено»). */
  cloudConsentGiven: boolean;
  docFontSize: number;
  weeklyLimitPages: number;
  /** Обработано страниц на текущей неделе (счётчик). */
  pagesThisWeek: number;
  weekAnchor: string;
  /** Включена ли тёмная тема. */
  darkMode: boolean;
  /**
   * Отображаемое имя пользователя для отчётов администратора.
   * Необязательное: если пусто, в сводке показывается короткий ID.
   */
  userName: string;
  /**
   * Анонимный идентификатор установки. Генерируется один раз и
   * отправляется вместе с облачными запросами, чтобы администратор
   * видел, кто именно израсходовал токены. Персональные данные не нужны.
   */
  clientId: string;
}

/** Словарь защиты проекта/глобальный (ТЗ §4.5). */
export interface ProtectionDict {
  terms: string[];
}

export type ViewMode = 'edit' | 'compare' | 'result';

export type Screen = 'editor' | 'sense' | 'protection' | 'style' | 'history' | 'export' | 'settings' | 'audit' | 'account';

/** Тост. */
export interface Toast {
  id: string;
  kind: 'info' | 'ok' | 'warn' | 'bad';
  message: string;
  actionLabel?: string;
  action?: () => void;
}

/** Состояние пакетной обработки (FR-6.x). */
export interface BatchState {
  running: boolean;
  paused: boolean;
  total: number;
  done: number;
  failed: number;
  startedAt: number;
  etaMs: number;
  currentParagraphId?: string;
}
