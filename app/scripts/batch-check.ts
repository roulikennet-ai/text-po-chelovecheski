/* ============================================================================
   batch-check.ts — проверки паузы и остановки пакетной обработки.
   Запуск: npm run batch-check
   ========================================================================== */

import { runBatch } from '../src/core/batch';
import { AbortedError, type Engine, type EngineRequest, type EngineResult } from '../src/engines/engine';
import type { Paragraph } from '../src/core/types';

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !extra ? '' : ` — ${extra}`}`);
  if (!ok) failures += 1;
}

/** Текст без защищаемых сущностей, чтобы фиктивный движок не терял токены. */
function paragraphs(n: number): Paragraph[] {
  const text = 'В ходе работы был проведён подробный анализ публикаций по теме.';
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    original: text,
    current: text,
    variants: [],
    status: 'original' as const,
    protectedSpans: [],
    blockKind: 'paragraph' as const,
  }));
}

/** Движок, который отвечает с заданной задержкой и уважает отмену. */
class TimedEngine implements Engine {
  readonly kind = 'local' as const;
  readonly label = 'timed';
  started: string[] = [];
  constructor(private delayMs: number) {}
  async isAvailable() {
    return true;
  }
  rewrite(req: EngineRequest): Promise<EngineResult> {
    this.started.push(req.seed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Возвращаем ровно то, что пришло: токены остаются на месте.
        resolve({ masked: req.masked, elapsedMs: this.delayMs, engine: 'local' });
      }, this.delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new AbortedError());
      };
      if (req.signal?.aborted) return onAbort();
      req.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

const runSettings = { preset: 'F1' as const, intensity: 3 as const, compressTarget: 30 as const };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main() {
  // 1. Обычный проход: все абзацы обработаны.
  {
    const engine = new TimedEngine(5);
    const controller = new AbortController();
    const outcome = await runBatch({
      targets: paragraphs(5),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => false,
    });
    check('полный проход: 5 из 5', outcome.done === 5, `done=${outcome.done}`);
    check('полный проход: без ошибок', outcome.failed === 0, `failed=${outcome.failed}`);
    check('полный проход: не остановлен', !outcome.stopped && !outcome.stale);
    check('полный проход: символы посчитаны', outcome.processedChars > 0);
  }

  // 2. Стоп: обработка прекращается, готовые абзацы сохраняются.
  {
    const engine = new TimedEngine(30);
    const controller = new AbortController();
    const promise = runBatch({
      targets: paragraphs(10),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => false,
    });
    await sleep(80);
    controller.abort();
    const outcome = await promise;
    check('стоп: помечен остановленным', outcome.stopped);
    check('стоп: обработано меньше десяти', outcome.done < 10, `done=${outcome.done}`);
    // После остановки движок больше не вызывается.
    const callsAtStop = engine.started.length;
    await sleep(200);
    check('стоп: новых вызовов движка нет', engine.started.length === callsAtStop, `calls=${engine.started.length}`);
  }

  // 3. Стоп до запуска: ни один абзац не обрабатывается.
  {
    const engine = new TimedEngine(5);
    const controller = new AbortController();
    controller.abort();
    const outcome = await runBatch({
      targets: paragraphs(4),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => false,
    });
    check('стоп заранее: 0 обработано', outcome.done === 0 && outcome.stopped);
    check('стоп заранее: движок не вызывался', engine.started.length === 0);
  }

  // 4. Пауза до запуска: обработка не начинается, пока пауза включена.
  {
    const engine = new TimedEngine(5);
    const controller = new AbortController();
    let paused = true;
    const promise = runBatch({
      targets: paragraphs(3),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => paused,
    });
    await sleep(200);
    check('пауза: движок ещё не вызывался', engine.started.length === 0, `calls=${engine.started.length}`);
    paused = false;
    const outcome = await promise;
    check('пауза снята: все абзацы обработаны', outcome.done === 3, `done=${outcome.done}`);
  }

  // 5. Пауза во время абзаца: текущий прерывается и повторяется, не теряется.
  {
    const engine = new TimedEngine(60);
    const controller = new AbortController();
    let paused = false;
    let stepController: AbortController | undefined;
    const promise = runBatch({
      targets: paragraphs(3),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => {
        stepController = new AbortController();
        return stepController.signal;
      },
      isPaused: () => paused,
    });
    await sleep(30);
    // Ставим паузу и отменяем текущий шаг, как делает кнопка «Пауза».
    paused = true;
    stepController?.abort();
    await sleep(250);
    const callsDuringPause = engine.started.length;
    await sleep(150);
    check('пауза: новых абзацев не начинается', engine.started.length === callsDuringPause, `calls=${engine.started.length}`);
    paused = false;
    const outcome = await promise;
    check('после паузы обработаны все 3', outcome.done === 3, `done=${outcome.done}`);
    check('после паузы: не остановлено', !outcome.stopped);
    check('текущий абзац был запущен повторно', engine.started.length > 3, `calls=${engine.started.length}`);
  }

  // 6. Пауза без отмены шага тоже останавливает старт новых абзацев.
  {
    const engine = new TimedEngine(10);
    const controller = new AbortController();
    let paused = true;
    const promise = runBatch({
      targets: paragraphs(4),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => paused,
    });
    await sleep(150);
    check('мягкая пауза: движок не вызывался', engine.started.length === 0);
    paused = false;
    const outcome = await promise;
    check('мягкая пауза: обработаны все 4', outcome.done === 4, `done=${outcome.done}`);
  }

  // 7. Смена проекта: пакет прекращается и помечается stale.
  {
    const engine = new TimedEngine(20);
    const controller = new AbortController();
    let stale = false;
    const promise = runBatch({
      targets: paragraphs(6),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => false,
      isStale: () => stale,
    });
    await sleep(50);
    stale = true;
    const outcome = await promise;
    check('смена проекта: пакет помечен stale', outcome.stale);
    check('смена проекта: обработано меньше шести', outcome.done < 6, `done=${outcome.done}`);
  }

  // 8. Сбой движка не роняет пакет: конвейер даёт фолбэк на правила.
  {
    class FailingEngine extends TimedEngine {
      async rewrite(): Promise<EngineResult> {
        throw new Error('сеть недоступна');
      }
    }
    const controller = new AbortController();
    const results: string[] = [];
    const outcome = await runBatch({
      targets: paragraphs(2),
      runSettings,
      engine: new FailingEngine(1),
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => false,
      onResult: (id, res) => results.push(res.paragraph.current),
    });
    check('сбой движка: пакет дошёл до конца', outcome.done === 2, `done=${outcome.done}`);
    check('сбой движка: результат не пустой', results.every((t) => t.length > 0));
  }

  // 9. Прогресс сообщается и не убывает.
  {
    const engine = new TimedEngine(2);
    const controller = new AbortController();
    const seen: number[] = [];
    await runBatch({
      targets: paragraphs(4),
      runSettings,
      engine,
      dictionary: [],
      stopSignal: controller.signal,
      newStep: () => undefined,
      isPaused: () => false,
      onProgress: (p) => seen.push(p.done),
    });
    const monotonic = seen.every((v, idx) => idx === 0 || v >= seen[idx - 1]);
    check('прогресс: счётчик не убывает', monotonic, seen.join(','));
    check('прогресс: финальное значение 4', seen[seen.length - 1] === 4, `last=${seen[seen.length - 1]}`);
  }

  console.log(failures === 0 ? '\nВСЕ ПРОВЕРКИ ПАКЕТА ПРОЙДЕНЫ' : `\nПРОВАЛЕНО: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
