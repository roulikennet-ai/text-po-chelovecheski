/* ============================================================================
   ruleEngine.ts — офлайн-движок переписывания на правилах.
   Работает БЕЗ сети и без модели: детерминированные преобразования
   по пресетам F1–F4 и уровням 1–5. Гарантия неизменяемого обеспечивается
   тем, что движок получает УЖЕ ЗАМАСКИРОВАННЫЙ текст (токены вместо чисел
   и имён) — см. pipeline.ts.
   ========================================================================== */

import type { CompressTarget, Intensity, PresetId } from '../core/types';
import { CANCELARISMS, CONNECTIVES, FILLER_WORDS, INTRO_PHRASES, pick } from '../core/lexicon';
import { carriesProtectedMeaning } from '../core/validation';

export interface RewriteOptions {
  preset: PresetId;
  intensity: Intensity;
  compressTarget: CompressTarget;
  /** Для вариативности (детерминированный выбор синонимов). */
  seed: string;
}

/** Уровни 1–2: меняем только слова внутри предложения. */
const WORD_LEVEL = (i: Intensity): boolean => i <= 2;
/** Уровень 4+: разрешены перестановки и связки. */
const STRUCTURE_LEVEL = (i: Intensity): boolean => i >= 4;

/** Разбить на предложения, сохраняя терминаторы. */
export function splitSentences(text: string): string[] {
  // Токены защиты (⟦Ч2⟧) могут содержать точки, запятые и тире — «2015–2023 гг.»
  // или «7.0.5». Временно прячем их, иначе предложение рвётся внутри токена.
  const stash: string[] = [];
  const guarded = text.replace(/⟦[^⟧]*⟧/g, (m) => {
    stash.push(m);
    return `\u0000${stash.length - 1}\u0000`;
  });

  const parts = guarded.match(/[^.!?…]+[.!?…]+(?:["»)]*)?|[^.!?…]+$/g);
  if (!parts) return text.trim() ? [text] : [];
  return parts
    .map((s) => s.trim().replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? ''))
    .filter(Boolean);
}

/** Сделать первую букву заглавной. */
function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/** Убрать двойные пробелы и лишние знаки. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/^\s*[,;:]\s*/, '')
    .replace(/\s+$/g, '')
    .trim();
}

/**
 * Финальная нормализация склеек: «, .» → «.», «.,» → «.», двойные точки,
 * запятая перед закрывающей скобкой/тире, висящие союзы в конце фразы.
 * Токены защиты (⟦…⟧) не трогаем.
 */
/**
 * Финальная нормализация склеек: «, .» → «.», «.,» → «.», двойные точки,
 * запятая перед закрывающей скобкой/тире, висящие союзы в конце фразы.
 * Токены защиты (⟦…⟧) не трогаем.
 */
export function normalizeFinal(s: string): string {
  return s
    .replace(/\s*,\s*(?=[.!?…])/g, '')
    .replace(/\.\s*,/g, '.')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/,\s*\)/g, ')')
    .replace(/,\s*([—–-])\s*/g, ' $1 ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Применить словарь канцелярита. */
function applyCancelarisms(text: string): string {
  let out = text;
  for (const [re, repl] of CANCELARISMS) {
    out = out.replace(re, repl);
  }
  return out;
}

/** Удалить клише-вставки в начале предложения (FR-4.1). */
function stripIntroPhrases(sentence: string): string {
  let out = sentence;
  let changed = true;
  let guard = 0;
  while (changed && guard < 4) {
    changed = false;
    guard += 1;
    for (const phrase of INTRO_PHRASES) {
      const re = new RegExp(`^\\s*${escapeRe(phrase)}\\s*[,:—-]?\\s*`, 'iu');
      if (re.test(out)) {
        out = out.replace(re, '');
        changed = true;
      }
    }
  }
  // Если убрали всё до терминатора — вернуть исходное.
  if (out.replace(/[^\wа-яё]/giu, '').length < 3) return sentence;
  return capitalize(out);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Удалить «воду» (F2 и уровень 3+). */
function removeFillers(text: string): string {
  let out = text;
  for (const w of FILLER_WORDS) {
    const re = new RegExp(`(^|[\\s,(])${escapeRe(w)}(?=[\\s,.)]|$)`, 'giu');
    out = out.replace(re, '$1');
  }
  return out;
}

/** Убрать начальные связки-«пустышки» у предложения. */
function trimLeadingConnective(sentence: string): string {
  const re = /^(?:таким образом|следовательно|тем не менее|вместе с тем|при этом|в то же время|кроме того|помимо этого|более того)\s*[,:]?\s*/iu;
  if (!re.test(sentence)) return sentence;
  const trimmed = sentence.replace(re, '');
  // После удаления связки первое слово остаётся со строчной — это начало
  // предложения, значит нужна заглавная.
  if (trimmed.replace(/[^\wа-яё]/giu, '').length < 3) return sentence;
  return capitalize(trimmed);
}

/** Разбить длинное предложение на два по сочинительному союзу (уровень 2+). */
function splitLongSentence(sentence: string, targetMax = 22): string[] {
  const words = sentence.split(/\s+/);
  if (words.length <= targetMax) return [sentence];

  const terminators = sentence.match(/[.!?…]+$/)?.[0] ?? '';

  // Разрываем только на сочинительных союзах: «что», «который», «чтобы»
  // вводят придаточные, и отдельное предложение из них не получается.
  const mid = Math.floor(words.length / 2);
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 4; i < words.length - 4; i++) {
    const w = words[i].toLowerCase().replace(/[,;:]$/, '');
    const isBreak = /^(?:и|а|но|однако|поэтому|потому|затем|тогда)$/.test(w);
    if (isBreak) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
  }
  if (bestIdx === -1) return [sentence];

  const firstWords = words.slice(0, bestIdx);
  let secondWords = words.slice(bestIdx);
  // Убираем ведущий союз у второго предложения.
  if (/^(?:и|а|но|однако)$/.test((secondWords[0] ?? '').replace(/[,;:]$/, ''))) {
    secondWords = secondWords.slice(1);
  }
  if (firstWords.length < 3 || secondWords.length < 3) return [sentence];

  const first = tidy(firstWords.join(' ').replace(/,$/, '') + '.');
  const second = capitalize(tidy(secondWords.join(' ')) + terminators);
  return [first, second];
}

/** Объединить два коротких предложения (уровень 4+). */
function mergeShortSentences(sentences: string[], seed: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const cur = sentences[i];
    const next = sentences[i + 1];
    // Не склеиваем, если второе предложение начинается с токена защиты
    // или со связки — иначе получается «..., поэтому поэтому ...».
    const nextHead = (next ?? '').trim();
    const unsafeHead = !nextHead || /^⟦/.test(nextHead) || startsWithConnective(nextHead);
    if (
      next &&
      !unsafeHead &&
      cur.split(/\s+/).length <= 8 &&
      next.split(/\s+/).length <= 10 &&
      /[.]$/.test(cur)
    ) {
      const connective = pick(CONNECTIVES, seed + i);
      const head = cur.slice(0, -1);
      const tail = next.charAt(0).toLowerCase() + next.slice(1);
      out.push(tidy(`${head}. ${capitalize(connectivePrefix(connective))}${tail}`));
      i += 1;
      continue;
    }
    out.push(cur);
  }
  return out;
}

/**
 * Предложение уже начинается со связки/союза?
 * \b в JS не работает с кириллицей — используем lookaround-границы.
 */
function startsWithConnective(sentence: string): boolean {
  return /^(?:и|а|но|однако|поэтому|при этом|кроме того|в итоге|так|затем|далее|также|следовательно|таким образом)(?![а-яё])/iu.test(
    sentence,
  );
}

/** Ссылка/токен/перечисление — такое предложение нельзя двигать. */
function isAnchorSentence(sentence: string): boolean {
  return /^(?:⟦|[\d«"'(])/.test(sentence);
}

/** Переставить предложения внутри абзаца (уровень 4+). */
function reorderSentences(sentences: string[], seed: string): string[] {
  if (sentences.length < 3) return sentences;
  // Меняем местами 2-е и 3-е предложения, если они не начинаются со ссылок/токенов.
  const a = sentences[1];
  const b = sentences[2];
  if (!a || !b) return sentences;
  if (isAnchorSentence(a) || isAnchorSentence(b)) return sentences;
  if (startsWithConnective(a) || startsWithConnective(b)) return sentences;
  const flip = (seed.charCodeAt(0) + seed.length) % 2 === 0;
  if (!flip) return sentences;
  const copy = [...sentences];
  copy[1] = b;
  copy[2] = a;
  return copy;
}

/** Связки, после которых запятая не ставится. */
const NO_COMMA_CONNECTIVES = new Set([
  'поэтому',
  'в итоге',
  'в результате',
  'параллельно',
  'затем',
  'далее',
  'отсюда',
  'также',
  'потом',
]);

/** Собрать «связка + пробел/запятая» с учётом уже имеющейся запятой. */
function connectivePrefix(connective: string): string {
  if (connective.includes(',')) return `${connective} `;
  if (NO_COMMA_CONNECTIVES.has(connective)) return `${connective} `;
  return `${connective}, `;
}

/** Добавить связку в начало предложения (уровень 4+). */
function addConnective(sentence: string, index: number, seed: string): string {
  if (index === 0) return sentence;
  // Уже есть связка в начале — не дублируем.
  if (startsWithConnective(sentence)) return sentence;
  // Не начинаем связку с токена защиты или с придаточного оборота.
  if (/^⟦/.test(sentence)) return sentence;
  if (/^(?:что|чтобы|который|которая|которое|которые|если|когда|где|как|чем)(?![а-яё])/iu.test(sentence)) {
    return sentence;
  }
  const connective = pick(CONNECTIVES, seed + index);
  return `${capitalize(connectivePrefix(connective))}${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
}

/**
 * Расставить связки по абзацу без «частокола»:
 * не более одной связки на два предложения и без повторов одной и той же.
 * Иначе получается «Также, … Кроме того, … Затем … Затем …» — ритм
 * становится хуже исходного, а объём растёт на треть (H3, FR-7.4).
 */
function addConnectives(sentences: string[], seed: string): string[] {
  const used = new Set<string>();
  let sinceLast = 99;
  return sentences.map((s, i) => {
    sinceLast += 1;
    if (i === 0 || sinceLast < 2 || startsWithConnective(s)) return s;
    const next = addConnective(s, i, seed);
    if (next === s) return s;
    const head = next.split(/[, ]/, 1)[0]?.toLowerCase() ?? '';
    if (used.has(head)) return s;
    used.add(head);
    sinceLast = 0;
    return next;
  });
}

/** Развернуть маркированный список в прозу (F3). */
export function expandListToProse(items: string[], _seed?: string): string {
  const clean = items.map((s) => s.replace(/^\s*(?:[-–—•*·▪◦●]|\d{1,3}[.)])\s*/, '').trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return capitalize(clean[0]);

  const transitions = [
    'Прежде всего,',
    'Далее,',
    'Кроме того,',
    'Помимо этого,',
    'Также',
    'Наконец,',
  ];

  return clean
    .map((item, i) => {
      const body = item.replace(/[.;]$/, '');
      if (i === 0) return `${transitions[0]} ${body.charAt(0).toLowerCase()}${body.slice(1)}.`;
      const t = transitions[Math.min(i, transitions.length - 1)];
      return `${t} ${body.charAt(0).toLowerCase()}${body.slice(1)}.`;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Сжать текст до целевого объёма (F2). */
function compress(sentences: string[], target: CompressTarget, _seed?: string): string[] {
  const ratio = 1 - target / 100;
  const targetCount = Math.max(1, Math.round(sentences.length * ratio));
  if (sentences.length <= targetCount) return sentences;

  // Предложения с защищёнными фрагментами, числами, кванторами и
  // отрицаниями выбрасывать нельзя: это потеря фактов и смена силы
  // утверждения (R1–R4). Если таких предложений больше целевого объёма,
  // сжатие отменяется целиком.
  const mustKeep = sentences.map((s) => carriesProtectedMeaning(s));
  const mandatory = mustKeep.filter(Boolean).length;
  if (mandatory > targetCount) return sentences;

  // Оставляем предложения с наибольшей «информационной плотностью»:
  // больше токенов защиты и цифр → важнее.
  const scored = sentences.map((s, i) => {
    const protectedCount = (s.match(/⟦/g) ?? []).length;
    const lengthPenalty = s.split(/\s+/).length > 30 ? -1 : 0;
    return { s, i, score: protectedCount * 3 + lengthPenalty + (i === 0 ? 2 : 0) };
  });
  const keep = new Set(
    [...scored]
      .filter((x) => mustKeep[x.i])
      .map((x) => x.i),
  );
  const rest = [...scored]
    .filter((x) => !mustKeep[x.i])
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (const x of rest) {
    if (keep.size >= targetCount) break;
    keep.add(x.i);
  }
  return sentences.filter((_, i) => keep.has(i));
}

/**
 * Главная функция движка: переписать один абзац.
 * Вход — МАСКИРОВАННЫЙ текст (защищённые фрагменты уже токены).
 */
export function rewriteParagraph(masked: string, opts: RewriteOptions): string {
  const { preset, intensity, compressTarget, seed } = opts;
  let text = masked.trim();
  if (!text) return text;

  // Заголовки и короткие строки не трогаем структурно.
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 4) return text;

  // Шаг 1: канцелярит (все уровни).
  text = applyCancelarisms(text);

  // Шаг 2: клише-вставки (все уровни, FR-4.1).
  let sentences = splitSentences(text);
  sentences = sentences.map(stripIntroPhrases);

  // Шаг 3: «вода» — со 2-го уровня.
  if (intensity >= 2 || preset === 'F2') {
    sentences = sentences.map((s) => tidy(removeFillers(s)));
  }

  // Шаг 4: F2 — сокращение.
  if (preset === 'F2') {
    sentences = compress(sentences, compressTarget, seed);
  }

  // Шаг 5: уровни 2+ — разбить длинные предложения.
  if (intensity >= 2) {
    sentences = sentences.flatMap((s) => splitLongSentence(s, intensity >= 4 ? 18 : 24));
  }

  // Шаг 6: уровень 4+ — объединить короткие и добавить связки.
  if (STRUCTURE_LEVEL(intensity)) {
    const beforeLinks = sentences.join(' ');
    sentences = mergeShortSentences(sentences, seed);
    sentences = reorderSentences(sentences, seed);
    const withLinks = addConnectives(sentences, seed);
    // Связки — необязательная косметика. На коротких рубленых фразах они
    // раздувают текст на треть («Цель ясна.» → «Кроме того, цель ясна.»),
    // а это уже домысливание по FR-7.4. Если прирост выше 15 % —
    // отказываемся от связок, структуру всё равно улучшили слиянием.
    const grew = withLinks.join(' ').replace(/\s/g, '').length;
    const base = beforeLinks.replace(/\s/g, '').length;
    sentences = base > 0 && grew > base * 1.15 ? sentences : withLinks;
  }

  // Шаг 7: F4 — «живее»: убираем тяжёлые зачины, оставляем ритм.
  if (preset === 'F4') {
    sentences = sentences.map((s) => trimLeadingConnective(s));
  }

  // Шаг 8: уровень 1–2 — не меняем длину предложений сильно, только слова.
  if (WORD_LEVEL(intensity)) {
    sentences = sentences.map((s) => tidy(s));
  }

  // Шаг 9: финальная нормализация регистра первого символа.
  let out = sentences.join(' ').replace(/\s+/g, ' ').trim();
  out = normalizeFinal(out);
  out = capitalize(out);

  // Гарантия: если текст «схлопнулся» — вернуть исходный.
  if (out.replace(/[^\wа-яё⟦⟧]/giu, '').length < Math.max(8, text.replace(/[^\wа-яё⟦⟧]/giu, '').length * 0.35)) {
    return capitalize(masked.trim());
  }
  return out;
}

/** Вариант «короче» — агрессивнее по сжатию. */
export function variantShorter(masked: string, opts: RewriteOptions): string {
  return rewriteParagraph(masked, { ...opts, compressTarget: 30, intensity: Math.max(3, opts.intensity) as Intensity });
}

/** Вариант «больше связности» — добавляет переходы. */
export function variantCohesive(masked: string, opts: RewriteOptions): string {
  const base = rewriteParagraph(masked, { ...opts, intensity: Math.max(4, opts.intensity) as Intensity });
  const sentences = splitSentences(base);
  const withLinks = sentences.map((s, i) => (i === 0 ? s : addConnective(s, i, opts.seed + 'coh')));
  return capitalize(withLinks.join(' ').replace(/\s+/g, ' ').trim());
}
