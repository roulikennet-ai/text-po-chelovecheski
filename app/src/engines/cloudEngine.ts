/* ============================================================================
   cloudEngine.ts — облачный движок, OpenAI-совместимый API (FR-11.2).
   Запрос уходит только с согласия пользователя (M1, FR-SEC-2).
   Модель получает МАСКИРОВАННЫЙ текст — числа и имена уже заменены токенами.
   ========================================================================== */

import { AbortedError, EngineError, isAbortError, type Engine, type EngineRequest, type EngineResult } from './engine';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

export interface CloudConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Таймаут одного абзаца, мс (FR-5.2: ≤10 с). */
  timeoutMs: number;
}

export class CloudEngine implements Engine {
  readonly kind = 'cloud' as const;
  readonly label = 'Облако';

  constructor(private config: CloudConfig) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.config.apiKey && this.config.baseUrl);
  }

  private endpoint(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  }

  async rewrite(req: EngineRequest): Promise<EngineResult> {
    if (!this.config.apiKey) {
      throw new EngineError('Не задан ключ API. Откройте «Настройки → Движок».', 'no-key');
    }
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: req.preset === 'F4' ? 0.55 : 0.35,
          max_tokens: 1600,
          messages: [
            { role: 'system', content: buildSystemPrompt(req.preset, req.intensity, req.compressTarget) },
            { role: 'user', content: buildUserPrompt(req.masked) },
          ],
        }),
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        throw new EngineError('Ключ API отклонён провайдером. Проверьте ключ в настройках.', 'no-key');
      }
      if (res.status === 429) {
        throw new EngineError('Провайдер ограничил частоту запросов. Попробуйте позже.', 'quota');
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new EngineError(`Провайдер вернул ошибку ${res.status}. ${body.slice(0, 200)}`, 'network');
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new EngineError('Провайдер вернул пустой ответ.', 'unknown');
      }
      return { masked: content, elapsedMs: performance.now() - started, engine: 'cloud' };
    } catch (e) {
      if (req.signal?.aborted) throw new AbortedError();
      if (isAbortError(e)) throw new AbortedError();
      if (e instanceof EngineError) throw e;
      if ((e as Error).name === 'AbortError') {
        throw new EngineError(timedOut ? 'Модель отвечает дольше обычного.' : 'Запрос прерван.', 'timeout');
      }
      throw new EngineError('Не удалось связаться с облачным провайдером. Проверьте интернет и адрес API.', 'network');
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  async rewriteStream(req: EngineRequest, onChunk: (partial: string) => void): Promise<EngineResult> {
    if (!this.config.apiKey) {
      throw new EngineError('Не задан ключ API. Откройте «Настройки → Движок».', 'no-key');
    }
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.35,
          stream: true,
          messages: [
            { role: 'system', content: buildSystemPrompt(req.preset, req.intensity, req.compressTarget) },
            { role: 'user', content: buildUserPrompt(req.masked) },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new EngineError(`Провайдер вернул ошибку ${res.status}.`, 'network');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
            const piece = json.choices?.[0]?.delta?.content;
            if (piece) {
              acc += piece;
              onChunk(acc);
            }
          } catch {
            /* пропускаем некорректный чанк */
          }
        }
      }
      return { masked: acc.trim(), elapsedMs: performance.now() - started, engine: 'cloud' };
    } catch (e) {
      if (req.signal?.aborted) throw new AbortedError();
      if (isAbortError(e)) throw new AbortedError();
      if (e instanceof EngineError) throw e;
      if ((e as Error).name === 'AbortError') {
        throw new EngineError(timedOut ? 'Модель отвечает дольше обычного.' : 'Запрос прерван.', 'timeout');
      }
      throw new EngineError('Не удалось связаться с облачным провайдером.', 'network');
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}
