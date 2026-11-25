/* ============================================================================
   engine.ts — абстракция движка (FR-8.3.1). Единый интерфейс для облака
   и локального режима: переключение не меняет функций и экранов.
   ========================================================================== */

import type { EngineKind, PresetId, Intensity, CompressTarget } from '../core/types';

export interface EngineRequest {
  /** Маскированный текст (защищённые фрагменты заменены токенами). */
  masked: string;
  preset: PresetId;
  intensity: Intensity;
  compressTarget: CompressTarget;
  /** Дополнительные ограничения (профиль стиля). */
  styleHints?: {
    targetSentenceRange?: [number, number];
    preferredWords?: string[];
  };
  seed: string;
  signal?: AbortSignal;
}

export interface EngineResult {
  /** Маскированный результат (токены на месте). */
  masked: string;
  /** Сколько времени заняло. */
  elapsedMs: number;
  /** Движок, который реально отвечал. */
  engine: EngineKind;
}

export interface Engine {
  readonly kind: EngineKind;
  readonly label: string;
  /** Проверить доступность (например, есть ключ/модель). */
  isAvailable(): Promise<boolean>;
  /** Переписать один абзац. */
  rewrite(req: EngineRequest): Promise<EngineResult>;
  /** Переписать с потоковой выдачей (точечный режим, FR-5.2). */
  rewriteStream?(req: EngineRequest, onChunk: (partial: string) => void): Promise<EngineResult>;
}

/** Ошибка движка с человеческим сообщением. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: 'no-key' | 'network' | 'timeout' | 'quota' | 'unknown',
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/**
 * Остановка по требованию пользователя (кнопка «Стоп» или «Пауза»).
 * Отдельный класс, чтобы конвейер не путал её с таймаутом модели
 * и не подменял результат локальными правилами.
 */
export class AbortedError extends Error {
  constructor(message = 'Обработка остановлена.') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof AbortedError || (e as Error | null)?.name === 'AbortError';
}

/**
 * Объединить несколько сигналов отмены в один.
 * AbortSignal.any есть не во всех WebView, поэтому оставляем фолбэк.
 */
export function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => Boolean(s));
  if (list.length === 0) return new AbortController().signal;
  if (list.length === 1) return list[0];
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(list);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const s of list) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}
