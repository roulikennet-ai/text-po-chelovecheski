/* ============================================================================
   gigachat.ts — облачный движок GigaChat через локальный прокси.
   Ключ авторизации живёт на сервере (server/gigachat.mjs) и в браузер
   не попадает. Фронтенд знает только адрес прокси и имя модели.
   ========================================================================== */

import { AbortedError, EngineError, isAbortError, type Engine, type EngineRequest, type EngineResult } from './engine';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

export interface GigaChatConfig {
  /** Адрес прокси. По умолчанию — тот же origin, /api/gigachat. */
  proxyBase: string;
  model: string;
  /** Таймаут одного абзаца, мс (FR-5.2: ≤10 с). */
  timeoutMs: number;
  /**
   * Анонимный идентификатор установки и необязательное имя.
   * Нужны только для отчёта администратора «кто и сколько потратил».
   * Текст документа в отчёт не попадает.
   */
  clientId?: string;
  clientName?: string;
}

interface ChatResponse {
  ok?: boolean;
  content?: string;
  model?: string;
  error?: string;
  code?: string;
}

/** Достать человеческое сообщение из ответа прокси. */
async function readError(res: Response): Promise<EngineError> {
  let code = 'network';
  let message = `Прокси GigaChat вернул ${res.status}.`;
  try {
    const data = (await res.json()) as ChatResponse;
    if (data.error) message = data.error;
    if (data.code) code = data.code;
  } catch {
    /* тело не JSON — оставляем статус */
  }
  const normalized: 'no-key' | 'quota' | 'network' | 'unknown' =
    code === 'no-key' ? 'no-key' : code === 'quota' ? 'quota' : 'network';
  return new EngineError(message, normalized);
}

export class GigaChatEngine implements Engine {
  readonly kind = 'cloud' as const;
  readonly label = 'GigaChat';

  constructor(private config: GigaChatConfig) {}

  private endpoint(): string {
    const base = this.config.proxyBase.replace(/\/+$/, '');
    return `${base}/chat`;
  }

  /** Доступность: прокси отвечает и ключ на сервере задан. */
  async isAvailable(): Promise<boolean> {
    try {
      const base = this.config.proxyBase.replace(/\/+$/, '');
      const res = await fetch(`${base}/status`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return false;
      const data = (await res.json()) as { configured?: boolean };
      return Boolean(data.configured);
    } catch {
      return false;
    }
  }

  async rewrite(req: EngineRequest): Promise<EngineResult> {
    const started = performance.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    const onAbort = () => controller.abort();
    req.signal?.addEventListener('abort', onAbort);
    if (req.signal?.aborted) controller.abort();

    try {
      const res = await fetch(this.endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          system: buildSystemPrompt(req.preset, req.intensity, req.compressTarget),
          user: buildUserPrompt(req.masked),
          temperature: req.preset === 'F4' ? 0.55 : 0.35,
          maxTokens: 1600,
          // Метаданные для отчёта администратора (кто и когда). Не текст.
          clientId: this.config.clientId || undefined,
          clientName: this.config.clientName || undefined,
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw await readError(res);

      const data = (await res.json()) as ChatResponse;
      const content = data.content?.trim();
      if (!content) {
        throw new EngineError('GigaChat вернул пустой ответ.', 'unknown');
      }
      return { masked: content, elapsedMs: performance.now() - started, engine: 'cloud' };
    } catch (e) {
      // Остановка пользователем — не ошибка движка, пробрасываем как есть.
      if (req.signal?.aborted) throw new AbortedError();
      if (isAbortError(e)) throw new AbortedError();
      if (e instanceof EngineError) throw e;
      if ((e as Error).name === 'AbortError') {
        throw new EngineError(
          timedOut ? 'GigaChat отвечает дольше обычного.' : 'Запрос к GigaChat прерван.',
          'timeout',
        );
      }
      throw new EngineError('Не удалось связаться с прокси GigaChat. Проверьте, запущен ли сервер.', 'network');
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Проверить подключение к GigaChat: ключ на сервере + доступные модели. */
export async function checkGigaChat(
  proxyBase = '/api/gigachat',
): Promise<{ configured: boolean; models: string[]; chatModels: string[]; keySource: string; trustAnchors: boolean }> {
  const base = proxyBase.replace(/\/+$/, '');
  const statusRes = await fetch(`${base}/status`, { headers: { Accept: 'application/json' } });
  if (!statusRes.ok) throw new Error(`Прокси недоступен (${statusRes.status}).`);
  const status = (await statusRes.json()) as {
    configured?: boolean;
    keySource?: string;
    trustAnchors?: boolean;
    chatModels?: string[];
  };
  if (!status.configured) {
    return {
      configured: false,
      models: [],
      chatModels: status.chatModels ?? [],
      keySource: status.keySource ?? 'none',
      trustAnchors: Boolean(status.trustAnchors),
    };
  }
  const modelsRes = await fetch(`${base}/models`, { method: 'POST', headers: { Accept: 'application/json' } });
  const modelsData = (await modelsRes.json()) as { models?: string[]; chatModels?: string[]; error?: string };
  if (!modelsRes.ok) throw new Error(modelsData.error || `Список моделей недоступен (${modelsRes.status}).`);
  return {
    configured: true,
    models: modelsData.models ?? [],
    chatModels: modelsData.chatModels ?? [],
    keySource: status.keySource ?? 'none',
    trustAnchors: Boolean(status.trustAnchors),
  };
}
