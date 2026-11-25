/* ============================================================================
   validation.ts — проверка сохранности смысла (R1–R6) и индекс H1–H5.
   ========================================================================== */

import { clicheDensity, findCliches, findColloquial } from './cliches';
import { findProtectedSpans, NUMBER_PLAIN_RE } from './protection';
import type { HumanMetrics, SenseCheck, SenseIssue } from './types';

/** Извлечение «единиц смысла» из текста (FR-7.1). */
export interface SenseUnits {
  numbers: string[];
  names: string[];
  refs: string[];
  urls: string[];
  /** Модальности и кванторы для проверки силы утверждения. */
  quantifiers: string[];
  negations: number;
}

const QUANTIFIERS = ['все', 'всех', 'весь', 'вся', 'всё', 'большинство', 'меньшинство', 'некоторые', 'часть', 'многие', 'немногие', 'каждый', 'любой', 'ни один', 'никто', 'значительно', 'существенно', 'незначительно', 'слабо', 'сильно'];
const NEGATIONS = ['не', 'ни', 'нет', 'без', 'никогда', 'нигде', 'нельзя'];

function normalizeForCompare(s: string): string {
  return s.replace(/[\s\u00a0]/g, '').replace(/ё/g, 'е').replace(/[−–—]/g, '-');
}

/**
 * Имена сравниваем без учёта регистра: движок может строчить первую букву
 * при вставке связки («Большинство» → «большинство»), и это не потеря факта.
 */
function normalizeName(s: string): string {
  return normalizeForCompare(s).toLowerCase();
}

/** Кванторы и отрицания, которые нельзя терять при сжатии (R4). */
const PROTECTED_MEANING_RE =
  /(?:^|[^а-яё])(?:все|всех|весь|вся|всё|большинство|меньшинство|некоторые|часть|многие|немногие|каждый|любой|никто|ничто|ни один|не|ни|нет|без|никогда|нигде|нельзя)(?![а-яё])/iu;

/** Предложение несёт смысл, который нельзя выбрасывать при сжатии. */
export function carriesProtectedMeaning(sentence: string): boolean {
  return /⟦/.test(sentence) || PROTECTED_MEANING_RE.test(sentence);
}

/** Собрать единицы смысла. */
export function extractSenseUnits(text: string): SenseUnits {
  const numbers = (text.match(NUMBER_PLAIN_RE) ?? []).map(normalizeForCompare);

  // Имена, аббревиатуры, ссылки и URL берём из ТОЙ ЖЕ функции, что и
  // пайплайн маскирования. Это не дублирование, а принцип: гарантия
  // неизменяемого относится ровно к тому набору, который изымается
  // токенами. Если валидация придумывает свои «имена» (например, любое
  // слово с заглавной в начале предложения — «Концентрация», «Объём»),
  // она сообщает о потере того, что никогда не защищалось.
  const spans = findProtectedSpans(text);
  const names = spans
    .filter((s) => s.cls === 'name' || s.cls === 'abbr' || s.cls === 'latin')
    .map((s) => normalizeName(s.text));
  const refs = spans.filter((s) => s.cls === 'ref').map((s) => normalizeForCompare(s.text));
  const urls = spans.filter((s) => s.cls === 'url').map((s) => normalizeForCompare(s.text));

  const lower = text.toLowerCase();
  const quantifiers = QUANTIFIERS.filter((q) => {
    const re = new RegExp(`(^|[^а-яё])${q}([^а-яё]|$)`, 'iu');
    return re.test(lower);
  }).map((q) => q.toLowerCase());

  let negations = 0;
  for (const n of NEGATIONS) {
    const re = new RegExp(`(^|[^а-яё])${n}([^а-яё]|$)`, 'giu');
    negations += (lower.match(re) ?? []).length;
  }

  return { numbers, names, refs, urls, quantifiers, negations };
}

/** Проверить, что все защищённые единицы присутствуют в результате дословно. */
export function checkSense(original: string, result: string): SenseCheck {
  const src = extractSenseUnits(original);
  const dst = extractSenseUnits(result);
  const issues: SenseIssue[] = [];

  const dstNumbers = new Set(dst.numbers);
  const lostNumbers = src.numbers.filter((n) => !dstNumbers.has(n));
  for (const n of lostNumbers) {
    issues.push({ kind: 'lost-number', message: `Потеряно число ${n}`, detail: n });
  }

  // Имена сравниваем по нормализованному тексту без учёта регистра.
  // Это принципиально: по правилам русского языка после вводной связки
  // («Кроме того, большинство…») слово пишется со строчной, и построчное
  // сравнение давало бы ложную «потерю факта» на каждом добавленном
  // переходе. Регистр — не факт, а орфография.
  const dstFlat = normalizeName(result);
  const lostNames = src.names.filter((n) => !dstFlat.includes(n));
  for (const n of lostNames) {
    issues.push({ kind: 'lost-name', message: `Потеряно имя или аббревиатура «${n}»`, detail: n });
  }

  const dstRefs = new Set(dst.refs);
  const lostRefs = src.refs.filter((r) => !dstRefs.has(r));
  for (const r of lostRefs) {
    issues.push({ kind: 'lost-ref', message: `Потеряна ссылка на источник ${r}`, detail: r });
  }

  // Новые факты: числа/ссылки, которых не было в исходнике (R6, FR-2.1).
  const srcNumbers = new Set(src.numbers);
  const addedNumbers = dst.numbers.filter((n) => !srcNumbers.has(n));
  for (const n of addedNumbers) {
    issues.push({ kind: 'added-fact', message: `Добавлено число ${n}, которого не было в исходнике`, detail: n });
  }
  const srcRefs = new Set(src.refs);
  for (const r of dst.refs) {
    if (!srcRefs.has(r)) {
      issues.push({ kind: 'added-fact', message: `Добавлена ссылка ${r}, которой не было в исходнике`, detail: r });
    }
  }

  // Сила утверждения и отрицания (FR-7.3).
  const lostQuant = src.quantifiers.filter((q) => !dst.quantifiers.includes(q));
  if (lostQuant.length > 0) {
    issues.push({
      kind: 'strength-changed',
      message: `Изменилась сила утверждения: пропали слова «${lostQuant.join('», «')}»`,
      detail: lostQuant.join(', '),
    });
  }
  if (Math.abs(src.negations - dst.negations) > 0) {
    issues.push({
      kind: 'strength-changed',
      message: `Изменилось число отрицаний: было ${src.negations}, стало ${dst.negations}`,
    });
  }

  // Клише в результате (H2).
  const cliches = findCliches(result);
  if (cliches.length > 0) {
    issues.push({
      kind: 'cliche',
      message: `В результате остались клише: ${cliches.slice(0, 3).map((c) => `«${c.phrase}»`).join(', ')}`,
      detail: String(cliches.length),
    });
  }

  // Новые списки (H1).
  const srcLists = (original.match(/^\s*(?:[-–—•*·▪◦●]|\d{1,3}[.)])\s+/gmu) ?? []).length;
  const dstLists = (result.match(/^\s*(?:[-–—•*·●]|\d{1,3}[.)])\s+/gmu) ?? []).length;
  if (dstLists > srcLists) {
    issues.push({ kind: 'new-list', message: `Появился новый список (было ${srcLists}, стало ${dstLists})` });
  }

  // Разговорность (H5).
  const colloquial = findColloquial(result);
  if (colloquial.length > 0) {
    issues.push({
      kind: 'register',
      message: `Сниженный регистр: ${colloquial.slice(0, 3).map((c) => `«${c.word}»`).join(', ')}`,
    });
  }

  // Результат длиннее исходника — возможное домысливание (FR-7.4).
  const srcLen = original.replace(/\s/g, '').length;
  const dstLen = result.replace(/\s/g, '').length;
  if (srcLen > 0 && dstLen > srcLen * 1.15) {
    issues.push({
      kind: 'longer',
      message: `Результат длиннее исходника на ${Math.round((dstLen / srcLen - 1) * 100)}% — проверьте, не добавлены ли пояснения`,
    });
  }

  const hardIssues = issues.filter((i) => i.kind === 'lost-number' || i.kind === 'lost-name' || i.kind === 'lost-ref');
  const softIssues = issues.filter((i) => i.kind !== 'lost-number' && i.kind !== 'lost-name' && i.kind !== 'lost-ref');

  const found = src.numbers.length + src.names.length + src.refs.length + src.urls.length;
  const kept = found - lostNumbers.length - lostNames.length - lostRefs.length - (src.urls.length - dst.urls.filter((u) => src.urls.includes(u)).length);

  const level: SenseCheck['level'] = hardIssues.length > 0 ? 'bad' : softIssues.length > 0 ? 'warn' : 'ok';

  return { level, found, kept: Math.max(0, kept), issues };
}

/** Метрики H1–H5 и индекс H (ТЗ §10.1). */
export function computeHumanMetrics(original: string, result: string, preset: string): HumanMetrics {
  // H1. Прозаичность
  const srcLists = (original.match(/^\s*(?:[-–—•*·▪◦●]|\d{1,3}[.)])\s+/gmu) ?? []).length;
  const dstLists = (result.match(/^\s*(?:[-–—•*·▪◦●]|\d{1,3}[.)])\s+/gmu) ?? []).length;
  let h1: number;
  if (preset === 'F3' && srcLists > 0) {
    h1 = Math.min(100, ((srcLists - dstLists) / srcLists) * 100);
  } else {
    h1 = dstLists <= srcLists ? 100 : Math.max(0, 100 - (dstLists - srcLists) * 25);
  }

  // H2. Плотность клише: ≤0,5 → 100; ≤3 → линейно.
  const density = clicheDensity(result);
  const h2 = density <= 0.5 ? 100 : Math.max(0, 100 - ((density - 0.5) / 2.5) * 100);

  // H3. Разнообразие ритма.
  const sentences = (result.match(/[^.!?…]+[.!?…]+/g) ?? []).map((s) => s.trim()).filter(Boolean);
  const lens = sentences.map((s) => s.split(/\s+/).length);
  const mean = lens.length > 0 ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const variance = lens.length > 0 ? lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length : 0;
  const sigma = Math.sqrt(variance);
  const sigmaScore = Math.min(100, (sigma / 4.5) * 100);

  let repeatedStarts = 0;
  for (let i = 0; i < sentences.length; i++) {
    const cur = (sentences[i].split(/\s+/).slice(0, 2).join(' ') || '').toLowerCase();
    for (let j = Math.max(0, i - 5); j < i; j++) {
      const prev = (sentences[j].split(/\s+/).slice(0, 2).join(' ') || '').toLowerCase();
      if (cur && cur === prev) {
        repeatedStarts += 1;
        break;
      }
    }
  }
  const repeatShare = sentences.length > 0 ? repeatedStarts / sentences.length : 0;
  const repeatScore = repeatShare <= 0.15 ? 100 : Math.max(0, 100 - ((repeatShare - 0.15) / 0.85) * 100);
  const h3 = Math.round(sigmaScore * 0.6 + repeatScore * 0.4);

  // H4. Связность: доля предложений с явными переходами.
  const connectiveRe = /^(?:при этом|кроме того|поэтому|в итоге|однако|но|также|далее|наконец|прежде всего|параллельно|наряду|отсюда|в результате|заметим)/iu;
  const withLinks = sentences.filter((s) => connectiveRe.test(s) || /(?:это|такой|такие|этот|эта|который|которая|которые)/iu.test(s)).length;
  const h4 = sentences.length > 0 ? Math.min(100, Math.round((withLinks / sentences.length) * 100)) : 100;

  // H5. Регистровая чистота.
  const colloquial = findColloquial(result).length;
  const h5 = colloquial === 0 ? 100 : Math.max(0, 100 - colloquial * 50);

  const total = Math.round(h1 * 0.25 + h2 * 0.25 + h3 * 0.2 + h4 * 0.15 + h5 * 0.15);
  return {
    h1: Math.round(h1),
    h2: Math.round(h2),
    h3,
    h4,
    h5,
    total,
  };
}

/** Метрики по всему документу. */
export function computeDocumentMetrics(
  pairs: Array<{ original: string; result: string }>,
  preset: string,
): HumanMetrics {
  if (pairs.length === 0) return { h1: 100, h2: 100, h3: 100, h4: 100, h5: 100, total: 100 };
  const all = pairs.map((p) => computeHumanMetrics(p.original, p.result, preset));
  const avg = (key: keyof HumanMetrics) => Math.round(all.reduce((a, m) => a + m[key], 0) / all.length);
  return {
    h1: avg('h1'),
    h2: avg('h2'),
    h3: avg('h3'),
    h4: avg('h4'),
    h5: avg('h5'),
    total: avg('total'),
  };
}
