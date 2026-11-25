/* ============================================================================
   abort-check.ts — проверка прерывания обработки (пауза/стоп).
   Запуск: esbuild + node (npx tsx зависает на этой машине).
   ========================================================================== */

import { processParagraph } from '../src/core/pipeline';
import { AbortedError, isAbortError, combineSignals, EngineError } from '../src/engines/engine';
import { LocalRuleEngine } from '../src/engines/localEngine';
import type { Paragraph } from '../src/core/types';
import type { Engine, EngineRequest, EngineResult } from '../src/engines/engine';

let failures = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failures += 1;
}

function makeParagraph(text: string): Paragraph {
  return {
    id: 'p_test',
    original: text,
    current: text,
    variants: [],
    status: 'original',
    protectedSpans: [],
    blockKind: 'paragraph',
  };
}

const TEXT =
  'В ходе исследования было проанализировано 12 образцов, собранных в 2019–2023 гг. Автор Петров отметил, что выборка репрезентативна.';

const baseOpts = {
  preset: 'F1' as const,
  intensity: 3 as const,
  compressTarget: 30 as const,
  dictionary: [] as string[],
};

/** Движок, который зависает, пока его не отменят. */
class HangingEngine implements Engine {
  readonly kind = 'local' as const;
  readonly label = 'hanging';
  calls = 0;
  async isAvailable() {
    return true;
  }
  rewrite(req: EngineRequest): Promise<EngineResult> {
    this.calls += 1;
    return new Promise((_resolve, reject) => {
      if (req.signal?.aborted) {
        reject(new AbortedError());
        return;
      }
      req.signal?.addEventListener('abort', () => reject(new AbortedError()), { once: true });
    });
  }
}

/** Движок, который отвечает, но игнорирует сигнал (медленная сеть). */
class SlowEngine implements Engine {
  readonly kind = 'local' as const;
  readonly label = 'slow';
  async isAvailable() {
    return true;
  }
  async rewrite(_req: EngineRequest): Promise<EngineResult> {
    await new Promise((r) => setTimeout(r, 30));
    return { masked: 'Готовый ответ.', elapsedMs: 30, engine: 'local' };
  }
}

async function main() {
  // 1. Уже отменённый сигнал — конвейер обязан бросить AbortedError,
  //    а не подменить результат локальными правилами.
  {
    const controller = new AbortController();
    controller.abort();
    let aborted = false;
    let other: unknown = null;
    try {
      await processParagraph(makeParagraph(TEXT), {
        ...baseOpts,
        engine: new LocalRuleEngine(),
        signal: controller.signal,
      });
    } catch (e) {
      aborted = isAbortError(e);
      other = e;
    }
    check('отменённый сигнал → AbortedError', aborted);
    if (!aborted) console.log('   получено:', other);
  }

  // 2. Отмена во время ожидания движка пробрасывается наружу.
  {
    const engine = new HangingEngine();
    const controller = new AbortController();
    const promise = processParagraph(makeParagraph(TEXT), { ...baseOpts, engine, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    let aborted = false;
    let other: unknown = null;
    try {
      await promise;
    } catch (e) {
      aborted = isAbortError(e);
      other = e;
    }
    check('отмена в процессе → AbortedError', aborted);
    if (!aborted) console.log('   получено:', other);
    check('отмена не порождает ретраев (1 вызов движка)', engine.calls === 1);
  }

  // 3. Обычная ошибка движка по-прежнему даёт фолбэк на правила.
  {
    class BrokenEngine extends SlowEngine {
      async rewrite(): Promise<EngineResult> {
        throw new EngineError('нет сети', 'network');
      }
    }
    const res = await processParagraph(makeParagraph(TEXT), { ...baseOpts, engine: new BrokenEngine() });
    check('ошибка сети → фолбэк на правила, текст не пуст', res.paragraph.current.length > 0);
    check('фолбэк сохраняет число 12', res.paragraph.current.includes('12'));
  }

  // 4. Результат приходит после отмены — он не должен считаться успешным.
  {
    const engine = new SlowEngine();
    const controller = new AbortController();
    const promise = processParagraph(makeParagraph(TEXT), { ...baseOpts, engine, signal: controller.signal });
    controller.abort();
    let aborted = false;
    try {
      await promise;
    } catch (e) {
      aborted = isAbortError(e);
    }
    check('отмена сразу после запуска → AbortedError', aborted);
  }

  // 5. combineSignals: пауза отменяет только свой шаг.
  {
    const batch = new AbortController();
    const step = new AbortController();
    const combined = combineSignals([batch.signal, step.signal]);
    check('составной сигнал сначала не отменён', !combined.aborted);
    step.abort();
    check('пауза отменяет шаг', combined.aborted);
    check('пакет при этом жив', !batch.signal.aborted);
  }

  // 6. combineSignals: стоп отменяет составной сигнал.
  {
    const batch = new AbortController();
    const step = new AbortController();
    const combined = combineSignals([batch.signal, step.signal]);
    batch.abort();
    check('стоп отменяет составной сигнал', combined.aborted);
  }

  // 7. Один сигнал возвращается как есть (без лишних обёрток).
  {
    const one = new AbortController();
    check('единственный сигнал не оборачивается', combineSignals([one.signal]) === one.signal);
  }

  // 8. Пустой список — сигнал, который никогда не отменится.
  {
    const s = combineSignals([]);
    check('пустой список → не отменён', !s.aborted);
  }

  console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПРЕРЫВАНИЯ ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
