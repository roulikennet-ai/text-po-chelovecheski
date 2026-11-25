/* ============================================================================
   localModel.ts — локальная GGUF-модель в браузере через wllama (WebAssembly).

   Модель скачивается один раз и кэшируется в браузере (OPFS/Cache Storage),
   дальше работает офлайн. Ни текст, ни модель не покидают компьютер.

   Модель грузится по требованию: первый запуск может занять минуты,
   поэтому прогресс отдаётся наружу через callback.
   ========================================================================== */

import type { Wllama as WllamaType } from '@wllama/wllama';
import {
  AbortedError,
  EngineError,
  isAbortError,
  type Engine,
  type EngineRequest,
  type EngineResult,
} from './engine';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

/** Путь к wasm-файлу. Копируется из @wllama/wllama в public/wllama/. */
function wasmPath(): string {
  // document читаем лениво: модуль импортируется и в node-проверках.
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL('wllama/wllama.wasm', base).href;
}

/** Готовые модели: короткое имя → адрес GGUF. */
export interface LocalModelPreset {
  id: string;
  name: string;
  url: string;
  sizeMb: number;
  note: string;
}

export const LOCAL_MODEL_PRESETS: LocalModelPreset[] = [
  {
    id: 'qwen2.5-0.5b',
    name: 'Qwen2.5 0.5B Instruct (Q4_K_M)',
    url: 'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
    sizeMb: 400,
    note: 'Самая лёгкая — чтобы попробовать. Качество правки скромное',
  },
  {
    id: 'qwen2.5-1.5b',
    name: 'Qwen2.5 1.5B Instruct (Q4_K_M)',
    url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
    sizeMb: 1000,
    note: 'Разумный баланс скорости и качества, ~2 ГБ памяти',
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen2.5 3B Instruct (Q4_K_M)',
    url: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    sizeMb: 2000,
    note: 'Заметно лучше держит смысл, нужно ~4 ГБ памяти',
  },
  {
    id: 'deepseek-r1-8b',
    name: 'DeepSeek-R1 8B (Q4_K_M)',
    url: 'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF/resolve/main/DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf',
    sizeMb: 5500,
    note: 'Продвинутые рассуждения, но тяжёлая — нужно ~10 ГБ памяти',
  },
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct (Q4_K_M)',
    url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    sizeMb: 2000,
    note: 'Альтернатива Qwen того же размера, нужно ~4 ГБ памяти',
  },
];

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelProgress {
  loaded: number;
  total: number;
  /** 0–100, либо -1 если размер неизвестен. */
  percent: number;
}

export interface ModelState {
  status: ModelStatus;
  url: string;
  progress: ModelProgress | null;
  message?: string;
}

type Listener = (s: ModelState) => void;

/**
 * Метка источника «файл с диска». Модель из файла живёт только в памяти
 * вкладки: после перезагрузки страницы файл нужно выбрать заново.
 */
export const FILE_SOURCE_ID = 'file';

/** Один экземпляр wllama на вкладку: модель тяжёлая, дублировать нельзя. */
let instance: WllamaType | null = null;
let loadedUrl = '';
let state: ModelState = { status: 'idle', url: '', progress: null };
let loadingPromise: Promise<void> | null = null;
/** Промис динамического импорта wllama: 150 КБ библиотеки грузим только при нужде. */
let libPromise: Promise<typeof import('@wllama/wllama')> | null = null;
const listeners = new Set<Listener>();

function emit(patch: Partial<ModelState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function getModelState(): ModelState {
  return state;
}

export function subscribeModelState(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/** Подгрузить библиотеку wllama по требованию (один раз на вкладку). */
function loadLib(): Promise<typeof import('@wllama/wllama')> {
  if (!libPromise) libPromise = import('@wllama/wllama');
  return libPromise;
}

/**
 * Объяснить ошибку загрузки модели человеческими словами.
 * Самая частая причина на больших файлах — обрыв соединения или прокси.
 */
function humanModelError(e: unknown): string {
  const raw = (e as Error)?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
    return (
      'Не удалось скачать файл модели: соединение прервано или адрес недоступен. ' +
      'Проверьте интернет, попробуйте другую ссылку — или скачайте .gguf вручную ' +
      'и нажмите «Файл с диска».'
    );
  }
  if (/QuotaExceeded/i.test(raw)) {
    return 'В браузере закончилось место для кэша модели. Очистите кэш ниже или выберите модель поменьше.';
  }
  if (/No supported storage backend/i.test(raw)) {
    return 'Браузер не даёт сохранить модель в своё хранилище. Откройте приложение в Chrome, Edge или Яндекс Браузере.';
  }
  return `Не удалось загрузить локальную модель: ${raw}`;
}

async function getInstance(): Promise<WllamaType> {
  if (!instance) {
    const { Wllama } = await loadLib();
    instance = new Wllama(
      { default: wasmPath() },
      {
        // Отключаем шумные нативные логи llama.cpp.
        suppressNativeLog: true,
        allowOffline: true,
      },
    );
  }
  return instance;
}

/**
 * Загрузить модель (или взять из кэша). Повторный вызов с тем же адресом
 * не перезагружает её.
 */
export function loadLocalModel(
  url: string,
  opts: { signal?: AbortSignal; nCtx?: number } = {},
): Promise<void> {
  if (!url) return Promise.reject(new EngineError('Не задан адрес локальной модели.', 'no-key'));
  if (instance && loadedUrl === url && state.status === 'ready') return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  emit({ status: 'loading', url, progress: null, message: undefined });

  loadingPromise = (async () => {
    const wllama = await getInstance();
    try {
      // Разные модели — разные веса: старую выгружаем.
      if (loadedUrl && loadedUrl !== url) {
        await wllama.exit().catch(() => undefined);
      }
      await wllama.loadModelFromUrl(url, {
        n_ctx: opts.nCtx ?? 4096,
        n_threads: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
        signal: opts.signal,
        progressCallback: ({ loaded, total }) => {
          emit({
            progress: {
              loaded,
              total,
              percent: total > 0 ? Math.round((loaded / total) * 100) : -1,
            },
          });
        },
      });
      loadedUrl = url;
      emit({ status: 'ready', url, progress: null, message: undefined });
    } catch (e) {
      if (opts.signal?.aborted) {
        emit({ status: 'idle', url, progress: null, message: 'Загрузка отменена.' });
        throw new AbortedError('Загрузка модели отменена.');
      }
      emit({ status: 'error', url, progress: null, message: (e as Error).message });
      throw new EngineError(humanModelError(e), 'network');
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * Загрузить модель из файла на диске (GGUF, выбранный пользователем).
 * Работает без сети и без CORS; после перезагрузки страницы файл
 * нужно выбрать снова.
 */
export function loadLocalModelFromFile(
  file: File,
  opts: { signal?: AbortSignal; nCtx?: number } = {},
): Promise<void> {
  if (!file) return Promise.reject(new EngineError('Файл модели не выбран.', 'no-key'));
  if (instance && loadedUrl === FILE_SOURCE_ID && state.status === 'ready') return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  emit({ status: 'loading', url: FILE_SOURCE_ID, progress: null, message: file.name });

  loadingPromise = (async () => {
    const wllama = await getInstance();
    try {
      await wllama.exit().catch(() => undefined);
      await wllama.loadModel([file], {
        n_ctx: opts.nCtx ?? 4096,
        n_threads: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
      });
      if (opts.signal?.aborted) throw new AbortedError('Загрузка модели отменена.');
      loadedUrl = FILE_SOURCE_ID;
      emit({ status: 'ready', url: FILE_SOURCE_ID, progress: null, message: file.name });
    } catch (e) {
      if (opts.signal?.aborted || isAbortError(e)) {
        emit({ status: 'idle', url: '', progress: null, message: 'Загрузка отменена.' });
        throw new AbortedError('Загрузка модели отменена.');
      }
      emit({ status: 'error', url: FILE_SOURCE_ID, progress: null, message: (e as Error).message });
      throw new EngineError(
        `Не удалось открыть файл модели: ${(e as Error).message}`,
        'unknown',
      );
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/** Выгрузить модель и освободить память. */
export async function unloadLocalModel(): Promise<void> {
  if (instance) {
    await instance.exit().catch(() => undefined);
  }
  loadedUrl = '';
  emit({ status: 'idle', url: '', progress: null, message: undefined });
}

/**
 * Сколько места занимают скачанные модели (МБ).
 * Если wllama уже загружена — считаем ровно файлы моделей. Иначе
 * библиотеку не тянем и возвращаем оценку всего хранилища приложения:
 * точную цифру даст только чтение кэша моделей.
 */
export async function estimateLocalStorageMb(): Promise<{ mb: number; exact: boolean } | null> {
  if (instance) {
    try {
      const list = await instance.cacheManager.list();
      const bytes = list.reduce((sum, e) => sum + (e.size || 0), 0);
      return { mb: Math.round(bytes / (1024 * 1024)), exact: true };
    } catch {
      return { mb: 0, exact: true };
    }
  }
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.usage) return null;
    return { mb: Math.round(est.usage / (1024 * 1024)), exact: false };
  } catch {
    return null;
  }
}

/** Удалить кэш моделей (браузерное хранилище). */
export async function clearModelCache(): Promise<void> {
  await unloadLocalModel();
  try {
    const wllama = await getInstance();
    const list = await wllama.cacheManager.list();
    for (const entry of list) {
      await wllama.cacheManager.delete(entry.name);
    }
  } catch {
    /* кэш мог быть пустым */
  }
}

/**
 * Движок на локальной GGUF-модели. Интерфейс тот же, что у облака:
 * пайплайн не знает, откуда пришёл ответ.
 */
export class GgufEngine implements Engine {
  readonly kind = 'local' as const;
  readonly label = 'Локальная модель';

  constructor(private url: string) {}

  async isAvailable(): Promise<boolean> {
    return state.status === 'ready' && loadedUrl === this.url;
  }

  async rewrite(req: EngineRequest): Promise<EngineResult> {
    const started = performance.now();
    if (req.signal?.aborted) throw new AbortedError();

    if (state.status !== 'ready' || loadedUrl !== this.url) {
      // Модель из файла нельзя скачать по адресу — её выбирают в настройках.
      if (this.url === FILE_SOURCE_ID) {
        throw new EngineError(
          'Локальная модель из файла не загружена. Откройте «Настройки» → «Локальная модель».',
          'no-key',
        );
      }
      await loadLocalModel(this.url, { signal: req.signal });
    }
    const wllama = await getInstance();

    try {
      const system = buildSystemPrompt(req.preset, req.intensity, req.compressTarget);
      const user = buildUserPrompt(req.masked);
      const temperature = req.preset === 'F4' ? 0.55 : 0.35;

      // Не у каждой GGUF есть chat template (например, базовые модели).
      // Тогда просим обычное продолжение текста по инструкции.
      const hasChatTemplate = Boolean(wllama.getChatTemplate?.());
      let content = '';

      if (hasChatTemplate) {
        const res = await wllama.createChatCompletion({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature,
          max_tokens: 1024,
          abortSignal: req.signal,
        });
        content = res.choices?.[0]?.message?.content?.trim() ?? '';
      } else {
        const res = await wllama.createCompletion({
          prompt: `${system}\n\n${user}\n\n`,
          temperature,
          max_tokens: 1024,
          abortSignal: req.signal,
        });
        content = res.choices?.[0]?.text?.trim() ?? '';
      }

      if (!content) throw new EngineError('Локальная модель вернула пустой ответ.', 'unknown');
      return { masked: content, elapsedMs: performance.now() - started, engine: 'local' };
    } catch (e) {
      if (req.signal?.aborted || isAbortError(e)) {
        throw new AbortedError();
      }
      if (e instanceof EngineError) throw e;
      throw new EngineError(`Локальная модель не смогла ответить: ${(e as Error).message}`, 'unknown');
    }
  }
}
