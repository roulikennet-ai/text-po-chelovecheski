/* ============================================================================
   protection.ts — авто-защита и токенизация (FR-3.1, FR-3.2, A6, A7).
   Гарантия неизменяемого обеспечивается ПАЙПЛАЙНОМ: защищённый фрагмент
   изымается из текста, заменяется токеном-заглушкой и возвращается дословно.
   ========================================================================== */

import type { ProtectedSpan, ProtectionClass } from './types';

/** Префиксы токенов по классам — только для отладки, в экспорт не попадают. */
const TOKEN_PREFIX: Record<ProtectionClass, string> = {
  number: 'Ч',
  name: 'И',
  abbr: 'А',
  latin: 'Л',
  url: 'У',
  ref: 'С',
  manual: 'Р',
  dictionary: 'Т',
};

/** Символы-ограничители токена (используются также при валидации). */
export const TOKEN_OPEN = '⟦';
export const TOKEN_CLOSE = '⟧';

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"«»]+/giu;

/** Ссылки вида [12], [12, с. 45], [12; 15]. */
const BRACKET_REF_RE = /\[\s*\d+(?:\s*[;,–-]\s*(?:с\.\s*)?\d+(?:\s*[–-]\s*\d+)?)*\s*\]/g;

/** Ссылки вида (Иванов, 2019), (Иванов и др., 2019), (Smith, 2020). */
const PAREN_REF_RE =
  /\(\s*[A-ZА-ЯЁ][\wА-Яа-яЁё-]+(?:\s+(?:и|and)\s+[A-ZА-ЯЁ][\wА-Яа-яЁё-]+)?(?:\s+и\s+др\.)?\s*,\s*(?:19|20)\d{2}[а-я]?\s*\)/g;

/**
 * Ядро числового шаблона без единиц измерения: 12; 12,4; 12,4 ± 0,3;
 * 12–15; 92,5 %; 2019; 1 200; 10-12.
 *
 * Единый источник и для маскирования (`NUMBER_RE`), и для сравнения
 * смысла (`NUMBER_PLAIN_RE` в validation.ts) — чтобы паттерны не расходились.
 *
 * Важно: `\b` в JS не работает с кириллицей, поэтому границы заданы
 * явными lookaround-проверками.
 */
export const NUMBER_CORE =
  String.raw`(?:[±+\-−]\s*)?(?<![А-Яа-яЁё0-9])\d+(?:[ \u00a0]\d{3})*(?:[.,]\d+)*(?:\s*[±+\-−]\s*\d+(?:[.,]\d+)?)?(?:\s*[–—-]\s*\d+(?:[.,]\d+)*)?(?:\s*%)?`;

/** Единицы измерения, которые прилипают к числу: «36,6 °C», «10 мг/кг», «5 км». */
const NUMBER_UNITS =
  String.raw`(?:\s*(?:°\s*[CFС]?|кг\/м3|кг|км\/ч|м\/с|мг\/кг|ммоль\/л|мм\s*рт\.\s*ст\.|уд\/мин|см|мм|км|мин|мл|мг|чел\.|человек|испытуемы[хе]|балл(?:а|ов)?|раз(?:а)?|года?|лет|гг\.?|сут(?:ки|ок)?|недел[ьию]|мес(?:яц(?:а|ев)?)?|дн(?:я|ей)|ч|с|л|г|м))?`;

/**
 * Числа и всё, что нельзя менять: 12; 12,4; 12,4 ± 0,3; 12–15; 92,5 %;
 * 2019; 1 200; 10-12; 2:1; 45°; 36,6 °C; 10 мг/кг; 7.0.5-2008 (ГОСТ).
 */
export const NUMBER_RE = new RegExp(NUMBER_CORE + NUMBER_UNITS + String.raw`(?![А-Яа-яЁё0-9])`, 'gu');

/** То же ядро без единиц — для сравнения единиц смысла (validation.ts). */
export const NUMBER_PLAIN_RE = new RegExp(NUMBER_CORE + String.raw`(?![А-Яа-яЁё0-9])`, 'gu');

/**
 * Аббревиатуры: «РФ», «ВКР», «МГУ», «ФКиС», инициалы «И.И.» и «И. И.».
 * Кириллические границы слова — через lookaround, а не `\b`.
 */
const ABBR_RE =
  /(?<![А-Яа-яЁё])(?:[А-ЯЁ]{2,}(?:\.[А-ЯЁ]{1,3})*\.?|[А-ЯЁ](?:\.[\s]?[А-ЯЁ])+\.?|[А-ЯЁ][а-яё]{0,4}[А-ЯЁ]{1,3})(?![А-Яа-яЁё])/gu;

/** Латиница: слова и короткие фразы. */
const LATIN_RE = /\b[A-Za-z][A-Za-z0-9'’.-]*(?:\s+[A-Za-z][A-Za-z0-9'’.-]*){0,3}\b/g;

/** Слова с заглавной кириллической буквы — кандидаты в имена собственные. */
const CAPITALIZED_RE = /(?<![А-Яа-яЁё])[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?(?![А-Яа-яЁё])/g;

/**
 * Аббревиатуры смешанного регистра: «СПбГУ», «РосНано», «МинОбр».
 * Отдельная регулярка нужна потому, что CAPITALIZED_RE требует строчную
 * сразу после первой заглавной и такие слова не видит вовсе.
 */
const MIXED_ABBR_RE = /(?<![А-Яа-яЁё])[А-ЯЁ][А-ЯЁа-яё]{1,9}(?![А-Яа-яЁё])/g;

/** Частые слова, которые не являются именами даже с заглавной буквы. */
export const NOT_NAMES = new Set(
  [
    'однако',
    'поэтому',
    'кроме',
    'также',
    'таким',
    'такие',
    'такая',
    'такой',
    'этот',
    'эта',
    'эти',
    'это',
    'данный',
    'данная',
    'данные',
    'данном',
    'настоящей',
    'настоящего',
    'современный',
    'современной',
    'современном',
    'важно',
    'следует',
    'необходимо',
    'стоит',
    'если',
    'когда',
    'чтобы',
    'потому',
    'согласно',
    'например',
    'введение',
    'заключение',
    'глава',
    'раздел',
    'таблица',
    'рисунок',
    'рис',
    'вывод',
    'выводы',
    'цель',
    'задачи',
    'объект',
    'предмет',
    'методы',
    'методика',
    'результаты',
    'исследование',
    'исследования',
    'исследований',
    'работа',
    'работы',
    'статья',
    'статьи',
    'автор',
    'авторы',
    'учёные',
    'исследователи',
    'специалисты',
    'тренер',
    'тренеры',
    'спортсмены',
    'студенты',
    'занятия',
    'упражнение',
    'упражнения',
    'нагрузка',
    'нагрузки',
    'спорт',
    'спорта',
    'физическая',
    'физической',
    'культура',
    'культуры',
    'образование',
    'образования',
    'педагогика',
    'педагогики',
    'психология',
    'психологии',
    'теория',
    'теории',
    'практика',
    'практики',
    'наука',
    'науки',
    'россия',
    'россии',
    'российская',
    'российской',
    'москва',
    'москве',
    'москвы',
    'петербург',
    'петербурге',
    'сибирский',
    'сибирского',
    'уральский',
    'уральского',
    // Глаголы и наречия в начале предложения — не имена.
    'следует',
    'следовательно',
    'предполагается',
    'отмечается',
    'подчеркнём',
    'подчеркнем',
    'отметим',
    'заметим',
    'рассмотрим',
    'допустим',
    'оказывается',
    'получается',
    'требуется',
    'необходимо',
    'предстоит',
    'представляется',
    'предположим',
    'сравним',
    'напомним',
    'уточним',
    'подведём',
    'подведем',
    'перейдём',
    'перейдем',
    'обратим',
    'остановимся',
    'коснёмся',
    'коснемся',
    'вернёмся',
    'вернемся',
    'выясним',
    'выделим',
    'определим',
    'докажем',
    'покажем',
    'отсюда',
    'итак',
    'впрочем',
    'напротив',
    'наоборот',
    'вероятно',
    'возможно',
    'разумеется',
    'безусловно',
    'несомненно',
    'действительно',
    'соответственно',
    'следовательно',
    'во-первых',
    'во-вторых',
    'в-третьих',
    'наконец',
    'однако',
    'по-видимому',
    'по-прежнему',
  ].map((w) => w.toLowerCase()),
);

export interface TokenizeResult {
  /** Текст с токенами вместо защищённых фрагментов. */
  masked: string;
  /** Найденные фрагменты в порядке появления. */
  spans: ProtectedSpan[];
  /** Карта токен → оригинал. */
  tokenMap: Map<string, string>;
}

/** Смещение всех вхождений регулярки в тексте. */
function collect(re: RegExp, text: string, cls: ProtectionClass, out: ProtectedSpan[], used: boolean[]): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    if (!value || value.trim().length === 0) continue;
    const start = m.index;
    const end = start + value.length;
    let free = true;
    for (let i = start; i < end; i++) if (used[i]) { free = false; break; }
    if (!free) continue;
    for (let i = start; i < end; i++) used[i] = true;
    out.push({ text: value, start, end, cls, token: '' });
  }
}

/**
 * Главная функция: найти все защищённые фрагменты в абзаце.
 * Порядок важен: сначала «широкие» сущности (URL, ссылки), затем числа,
 * латиница, аббревиатуры, и в конце — имена собственные.
 */
export function findProtectedSpans(
  text: string,
  manualRanges: Array<{ start: number; end: number }> = [],
  dictionary: string[] = [],
): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  const used = new Array<boolean>(text.length).fill(false);

  // 1. Ручная защита — приоритет выше авто.
  for (const r of manualRanges) {
    const start = Math.max(0, r.start);
    const end = Math.min(text.length, r.end);
    if (end <= start) continue;
    for (let i = start; i < end; i++) used[i] = true;
    spans.push({ text: text.slice(start, end), start, end, cls: 'manual', token: '' });
  }

  // 2. URL и ссылки на источники.
  collect(URL_RE, text, 'url', spans, used);
  collect(BRACKET_REF_RE, text, 'ref', spans, used);
  collect(PAREN_REF_RE, text, 'ref', spans, used);

  // 3. Словарь терминов проекта (дословно, без учёта регистра).
  for (const term of dictionary) {
    const t = term.trim();
    if (t.length < 2) continue;
    const lower = text.toLowerCase();
    const needle = t.toLowerCase();
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + t.length;
      let free = true;
      for (let i = idx; i < end; i++) if (used[i]) { free = false; break; }
      if (free) {
        for (let i = idx; i < end; i++) used[i] = true;
        spans.push({ text: text.slice(idx, end), start: idx, end, cls: 'dictionary', token: '' });
      }
      from = idx + 1;
    }
  }

  // 4. Латиница — ДО чисел. Иначе «VO2max» и «HTML5» разрезаются: число
  // забирает «2»/«5», а латинский матч целиком отбрасывается как
  // пересекающийся, и в тексте остаётся незащищённый огрызок «VO»/«HTML».
  collect(LATIN_RE, text, 'latin', spans, used);

  // 5. Числа.
  collect(NUMBER_RE, text, 'number', spans, used);

  // 6. Аббревиатуры.
  collect(ABBR_RE, text, 'abbr', spans, used);

  // 6b. Аббревиатуры смешанного регистра: «СПбГУ», «РосНано», «МинОбр».
  // Основная ABBR_RE их не видит: она требует либо всё заглавными, либо
  // ровно одну строчную группу между заглавными.
  MIXED_ABBR_RE.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = MIXED_ABBR_RE.exec(text)) !== null) {
    const word = am[0];
    if (word.length < 3) continue;
    const upper = (word.match(/[А-ЯЁ]/g) ?? []).length;
    // Нужны минимум две заглавные внутри одного слова: «СПбГУ» — да,
    // «Средняя» — нет (одна заглавная в начале).
    if (upper < 2) continue;
    if (NOT_NAMES.has(word.toLowerCase())) continue;
    const start = am.index;
    const end = start + word.length;
    let free = true;
    for (let i = start; i < end; i++) if (used[i]) { free = false; break; }
    if (!free) continue;
    for (let i = start; i < end; i++) used[i] = true;
    spans.push({ text: word, start, end, cls: 'abbr', token: '' });
  }

  // 7. Имена собственные — эвристика по заглавной букве вне начала предложения.
  CAPITALIZED_RE.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CAPITALIZED_RE.exec(text)) !== null) {
    const word = cm[0];
    const start = cm.index;
    const end = start + word.length;
    if (NOT_NAMES.has(word.toLowerCase())) continue;

    let free = true;
    for (let i = start; i < end; i++) if (used[i]) { free = false; break; }
    if (!free) continue;

    // Определяем, стоит ли слово в начале предложения.
    let p = start - 1;
    while (p >= 0 && /[\s"'«(–—-]/.test(text[p])) p--;
    const atSentenceStart = p < 0 || /[.!?:;]/.test(text[p]);

    // В начале предложения защищаем только «сильные» имена:
    // наличие отчества/инициалов рядом или словарь имён-фамилий.
    const nextChunk = text.slice(end, end + 40);
    const hasPatronymic = /^\s+[А-ЯЁ][а-яё]+(?:ович|евич|ьевич|овна|евна|ична|инична)(?![А-Яа-яЁё])/.test(nextChunk);
    const looksLikeSurname = /(?:ов|ев|ин|ын|ский|цкий|ая|ко|ук|юк|ич|енко|чук|ян|дзе|швили)$/i.test(word);
    const prevChunk = text.slice(Math.max(0, start - 3), start);
    const afterInitial = /[А-ЯЁ]\.\s?$/.test(prevChunk);

    if (atSentenceStart && !hasPatronymic && !afterInitial && !looksLikeSurname) continue;

    for (let i = start; i < end; i++) used[i] = true;
    spans.push({ text: word, start, end, cls: 'name', token: '' });
  }

  // Сортировка и присвоение токенов.
  spans.sort((a, b) => a.start - b.start);
  const counters: Record<string, number> = {};
  for (const s of spans) {
    counters[s.cls] = (counters[s.cls] ?? 0) + 1;
    s.token = `${TOKEN_OPEN}${TOKEN_PREFIX[s.cls]}${counters[s.cls]}${TOKEN_CLOSE}`;
  }
  return spans;
}

/** Заменить защищённые фрагменты токенами. */
export function maskText(text: string, spans: ProtectedSpan[]): TokenizeResult {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  const tokenMap = new Map<string, string>();
  for (const s of sorted) {
    if (s.start < cursor) continue;
    out += text.slice(cursor, s.start);
    out += s.token;
    tokenMap.set(s.token, s.text);
    cursor = s.end;
  }
  out += text.slice(cursor);
  return { masked: out, spans: sorted, tokenMap };
}

/**
 * Вернуть защищённые фрагменты на место дословно (FR-3.2).
 * Если токен потерян — фиксируем это (для валидации R1/R2/R3).
 */
export function unmaskText(masked: string, tokenMap: Map<string, string>): { text: string; lostTokens: string[] } {
  let out = masked;
  const lostTokens: string[] = [];
  for (const [token, original] of tokenMap) {
    if (!out.includes(token)) {
      lostTokens.push(token);
      continue;
    }
    out = out.split(token).join(original);
  }
  return { text: out, lostTokens };
}

/** Полная токенизация абзаца: найти + замаскировать. */
export function tokenize(
  text: string,
  manualRanges: Array<{ start: number; end: number }> = [],
  dictionary: string[] = [],
): TokenizeResult {
  const spans = findProtectedSpans(text, manualRanges, dictionary);
  return maskText(text, spans);
}

/** Сводка по классам защиты для плашки S4 и экрана E6. */
export function protectionSummary(spans: ProtectedSpan[]): Record<ProtectionClass, number> {
  const res: Record<ProtectionClass, number> = {
    number: 0,
    name: 0,
    abbr: 0,
    latin: 0,
    url: 0,
    ref: 0,
    manual: 0,
    dictionary: 0,
  };
  for (const s of spans) res[s.cls] += 1;
  return res;
}

/** Человеческие подписи классов. */
export const PROTECTION_LABELS: Record<ProtectionClass, string> = {
  number: 'числа',
  name: 'имена',
  abbr: 'аббревиатуры',
  latin: 'латиница',
  url: 'ссылки',
  ref: 'источники',
  manual: 'ручная',
  dictionary: 'словарь',
};
