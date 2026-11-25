/* ============================================================================
   pipeline.ts — конвейер обработки абзаца (prompt.md):
   1. Токенизация → 2. Промпт → 3. Генерация → 4. Возврат заглушек →
   5. Валидация R/H → 6. Авторетрай до 2 попыток.
   ========================================================================== */

import { tokenize, unmaskText } from '../core/protection';
import { rewriteParagraph } from '../core/ruleEngine';
import { checkSense } from '../core/validation';
import type { CompressTarget, Intensity, Paragraph, PresetId, SenseCheck, Variant } from '../core/types';
import { uid } from '../core/paragraphs';
import { AbortedError, isAbortError, type Engine, type EngineRequest } from '../engines/engine';
import { LocalRuleEngine } from '../engines/localEngine';

export interface ProcessOptions {
  preset: PresetId;
  intensity: Intensity;
  compressTarget: CompressTarget;
  engine: Engine;
  /** Словарь защиты проекта. */
  dictionary: string[];
  /** Профиль стиля (опционально). */
  styleHints?: EngineRequest['styleHints'];
  signal?: AbortSignal;
}

export interface ProcessedParagraph {
  paragraph: Paragraph;
  sense: SenseCheck;
  /** Сколько попыток потребовалось. */
  attempts: number;
}

const MAX_ATTEMPTS = 3; // 1 основная + 2 ретрая (FR-4.3)

/**
 * Косметика после возврата токенов: защищённый фрагмент мог сам
 * заканчиваться точкой («2015–2023 гг.»), и добавленный терминатор
 * давал «гг..». Схлопываем двойные точки, не трогая многоточие.
 */
function polishRestored(text: string): string {
  return text
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/\s*,\s*(?=[.!?…])/g, '')
    .replace(/([!?…])\s*\./g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/**
 * Обработать один абзац: маскирование → генерация → возврат → валидация.
 * Возвращает абзац с новым current и вариантами, но НЕ меняет статус
 * на accepted — это решение автора.
 */
export async function processParagraph(p: Paragraph, opts: ProcessOptions): Promise<ProcessedParagraph> {
  const source = p.original;
  const seed = `${p.id}_${opts.preset}_${opts.intensity}`;

  // Шаг 1. Токенизация.
  const { masked, spans, tokenMap } = tokenize(source, [], opts.dictionary);

  let bestText = '';
  let bestSense: SenseCheck | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    attempts = attempt + 1;
    // Остановка пользователем — это не ошибка движка, выходим сразу.
    if (opts.signal?.aborted) throw new AbortedError();

    // Шаги 2–3. Генерация.
    let generated: string;
    try {
      const res = await opts.engine.rewrite({
        masked,
        preset: opts.preset,
        intensity: opts.intensity,
        compressTarget: opts.compressTarget,
        styleHints: opts.styleHints,
        seed: seed + (attempt > 0 ? `_r${attempt}` : ''),
        signal: opts.signal,
      });
      generated = res.masked;
    } catch (e) {
      // Отмену не подменяем локальными правилами: иначе «Стоп» продолжает
      // переписывать текст, а пауза не останавливает текущий абзац.
      if (isAbortError(e) || opts.signal?.aborted) throw new AbortedError();
      // Движок недоступен — честный фолбэк на локальные правила,
      // чтобы контур не «умирал» (S12 обрабатывается в UI отдельно).
      generated = rewriteParagraph(masked, {
        preset: opts.preset,
        intensity: opts.intensity,
        compressTarget: opts.compressTarget,
        seed: seed + `_fallback${attempt}`,
      });
    }

    if (opts.signal?.aborted) throw new AbortedError();

    // Шаг 4. Возврат заглушек дословно.
    const { text: rawRestored, lostTokens } = unmaskText(generated, tokenMap);
    const restored = polishRestored(rawRestored);

    // Шаг 5. Валидация.
    const sense = checkSense(source, restored);

    // Потерянные токены — жёсткая ошибка (R1/R2/R3).
    if (lostTokens.length > 0) {
      sense.level = 'bad';
      sense.issues.unshift({
        kind: 'lost-number',
        message: `Модель потеряла защищённый фрагмент: ${lostTokens.join(', ')}`,
      });
    }

    // FR-3.4: если защищённые фрагменты не вернулись — помечаем 🟡/🔴.
    if (restored.trim().length === 0) {
      continue;
    }

    if (!bestSense || scoreSense(sense) > scoreSense(bestSense)) {
      bestText = restored;
      bestSense = sense;
    }

    // Удовлетворительный результат — выходим.
    if (sense.level === 'ok') break;
    // На 🟡 одна повторная попытка; на 🔴 — до исчерпания.
  }

  const finalSense = bestSense ?? checkSense(source, source);
  const status: Paragraph['status'] =
    finalSense.level === 'bad' ? 'error' : finalSense.level === 'warn' ? 'warning' : 'processed';

  // Варианты для точечного режима: основной + 2 альтернативы.
  const variants = buildVariants(masked, tokenMap, opts, bestText, seed, finalSense);

  return {
    paragraph: {
      ...p,
      current: bestText || source,
      variants,
      status,
      protectedSpans: spans,
      sense: finalSense,
      accepted: false,
    },
    sense: finalSense,
    attempts,
  };
}

function scoreSense(s: SenseCheck): number {
  const levelScore = s.level === 'ok' ? 2 : s.level === 'warn' ? 1 : 0;
  return levelScore * 1000 + s.kept - s.issues.length * 10;
}

/** Построить 2–3 варианта переписывания (FR-5.1). */
function buildVariants(
  masked: string,
  tokenMap: Map<string, string>,
  opts: ProcessOptions,
  main: string,
  seed: string,
  mainSense: SenseCheck,
): Variant[] {
  const local = new LocalRuleEngine();
  const baseOpts = {
    preset: opts.preset,
    intensity: opts.intensity,
    compressTarget: opts.compressTarget,
    seed,
  };

  const extras = local.extraVariants(masked, baseOpts);
  const restorations = [
    { text: masked, label: 'ближе к исходному' },
    { text: extras[0], label: 'короче' },
    { text: extras[1], label: 'больше связности' },
  ];

  const variants: Variant[] = [
    { id: uid('v'), text: main, label: 'основной', sense: mainSense },
  ];

  for (const r of restorations) {
    const restored = polishRestored(unmaskText(r.text, tokenMap).text);
    if (restored.trim() === main.trim()) continue;
    const sense = checkSense(unmaskText(masked, tokenMap).text, restored);
    variants.push({ id: uid('v'), text: restored, label: r.label, sense });
    if (variants.length >= 3) break;
  }

  return variants;
}

/** Точечный режим: переписать выделенный фрагмент, вернуть 2–3 варианта. */
export async function processSpot(
  text: string,
  opts: ProcessOptions,
): Promise<{ variants: Variant[]; sense: SenseCheck }> {
  const seed = `spot_${Date.now()}`;
  const { masked, tokenMap } = tokenize(text, [], opts.dictionary);

  let main = '';
  try {
    const res = await opts.engine.rewrite({
      masked,
      preset: opts.preset,
      intensity: opts.intensity,
      compressTarget: opts.compressTarget,
      styleHints: opts.styleHints,
      seed,
      signal: opts.signal,
    });
    main = unmaskText(res.masked, tokenMap).text;
  } catch (e) {
    // Отмена пользователем не должна превращаться в локальный пересказ.
    if (isAbortError(e) || opts.signal?.aborted) throw new AbortedError();
    main = unmaskText(
      rewriteParagraph(masked, {
        preset: opts.preset,
        intensity: opts.intensity,
        compressTarget: opts.compressTarget,
        seed,
      }),
      tokenMap,
    ).text;
  }
  main = polishRestored(main);

  const sense = checkSense(text, main);
  const variants = buildVariants(masked, tokenMap, opts, main, seed, sense);
  return { variants, sense };
}
