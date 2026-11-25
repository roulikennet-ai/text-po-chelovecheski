/* ============================================================================
   batch.ts — пакетная обработка абзацев с паузой и остановкой (FR-6.x).

   Вынесено из EditorScreen, чтобы логику прерывания можно было проверить
   тестом: пауза отменяет только текущий абзац и повторяет его после
   «Продолжить», стоп отменяет пакет целиком.
   ========================================================================== */

import { processParagraph, type ProcessedParagraph } from './pipeline';
import { combineSignals, isAbortError, type Engine } from '../engines/engine';
import type { Paragraph, RunSettings } from './types';

export interface BatchProgress {
  done: number;
  failed: number;
  etaMs: number;
  /** Абзац, который обрабатывается прямо сейчас. */
  currentParagraphId?: string;
}

export interface BatchOutcome {
  done: number;
  failed: number;
  /** Символов фактически обработанных абзацев (для недельного лимита). */
  processedChars: number;
  /** Пакет остановлен кнопкой «Стоп». */
  stopped: boolean;
  /** Проект сменился во время обработки — результаты относятся к старому. */
  stale: boolean;
}

export interface RunBatchParams {
  targets: Paragraph[];
  runSettings: Pick<RunSettings, 'preset' | 'intensity' | 'compressTarget'>;
  engine: Engine;
  dictionary: string[];
  /** Полная остановка пакета. */
  stopSignal: AbortSignal;
  /**
   * Новый сигнал для одной попытки обработки абзаца.
   * Вызывается перед КАЖДОЙ попыткой: иначе после паузы сигнал остался бы
   * отменённым и повторная попытка того же абзаца прерывалась бы сразу.
   */
  newStep?: () => AbortSignal | undefined;
  /** Включена ли пауза. */
  isPaused: () => boolean;
  /** Проект заменён/закрыт — работу нужно прекратить. */
  isStale?: () => boolean;
  onProgress?: (p: BatchProgress) => void;
  onResult?: (id: string, res: ProcessedParagraph) => void;
  onError?: (id: string) => void;
  /** Ожидание снятия паузы; вынесено для тестируемости. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runBatch(params: RunBatchParams): Promise<BatchOutcome> {
  const { targets, runSettings, engine, dictionary, stopSignal, isPaused } = params;
  const isStale = params.isStale ?? (() => false);
  const sleep = params.sleep ?? defaultSleep;
  const startedAt = Date.now();

  let done = 0;
  let failed = 0;
  let processedChars = 0;
  let i = 0;
  let stopped = false;

  while (i < targets.length) {
    if (stopSignal.aborted) {
      stopped = true;
      break;
    }
    if (isStale()) break;

    // Пауза: не начинаем новые абзацы, пока пользователь не продолжит.
    while (isPaused() && !stopSignal.aborted) {
      await sleep(120);
    }
    if (stopSignal.aborted) {
      stopped = true;
      break;
    }
    if (isStale()) break;

    const target = targets[i];
    // Свежий сигнал шага на каждую попытку — пауза не «залипает».
    const signal = combineSignals([stopSignal, params.newStep?.()]);

    params.onProgress?.({ done, failed, etaMs: etaOf(startedAt, done, targets.length), currentParagraphId: target.id });

    try {
      const res = await processParagraph(target, {
        preset: runSettings.preset,
        intensity: runSettings.intensity,
        compressTarget: runSettings.compressTarget,
        engine,
        dictionary,
        signal,
      });
      // Отмена пришла в момент завершения — результат не применяем.
      if (signal.aborted) continue;
      if (isStale()) break;
      params.onResult?.(target.id, res);
      if (res.sense.level === 'bad') failed += 1;
      done += 1;
      processedChars += target.original.length;
      i += 1;
    } catch (e) {
      if (isAbortError(e) || signal.aborted) {
        // Пауза: тот же абзац повторится после «Продолжить».
        // Стоп: следующий проход цикла увидит aborted и выйдет.
        continue;
      }
      failed += 1;
      done += 1;
      processedChars += target.original.length;
      i += 1;
      params.onError?.(target.id);
    }

    params.onProgress?.({ done, failed, etaMs: etaOf(startedAt, done, targets.length) });
  }

  return { done, failed, processedChars, stopped, stale: isStale() };
}

function etaOf(startedAt: number, done: number, total: number): number {
  if (done <= 0) return 0;
  const elapsed = Date.now() - startedAt;
  return (elapsed / done) * (total - done);
}
