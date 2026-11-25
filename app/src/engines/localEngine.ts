/* ============================================================================
   localEngine.ts — офлайн-движок на правилах. Работает всегда, без сети.
   Это «локальный движок» в смысле FR-8.3: полная функциональность без
   интернета, среднее качество прозы, мгновенный отклик.
   ========================================================================== */

import { rewriteParagraph, variantCohesive, variantShorter } from '../core/ruleEngine';
import type { Engine, EngineRequest, EngineResult } from './engine';

export class LocalRuleEngine implements Engine {
  readonly kind = 'local' as const;
  readonly label = 'Локально (правила)';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async rewrite(req: EngineRequest): Promise<EngineResult> {
    const started = performance.now();
    const opts = {
      preset: req.preset,
      intensity: req.intensity,
      compressTarget: req.compressTarget,
      seed: req.seed,
    };
    const masked = rewriteParagraph(req.masked, opts);
    return { masked, elapsedMs: performance.now() - started, engine: 'local' };
  }

  /** Стриминг: отдаём результат по предложениям, имитируя поток. */
  async rewriteStream(req: EngineRequest, onChunk: (partial: string) => void): Promise<EngineResult> {
    const started = performance.now();
    const opts = {
      preset: req.preset,
      intensity: req.intensity,
      compressTarget: req.compressTarget,
      seed: req.seed,
    };
    const full = rewriteParagraph(req.masked, opts);
    const sentences = full.match(/[^.!?…]+[.!?…]+(?:["»)]*)?|[^.!?…]+$/g) ?? [full];
    let acc = '';
    for (const s of sentences) {
      if (req.signal?.aborted) break;
      acc += (acc ? ' ' : '') + s.trim();
      onChunk(acc);
      await new Promise((r) => setTimeout(r, 40));
    }
    return { masked: full, elapsedMs: performance.now() - started, engine: 'local' };
  }

  /** Дополнительные варианты для точечного режима (FR-5.1). */
  extraVariants(masked: string, req: Omit<EngineRequest, 'masked'>): string[] {
    const opts = {
      preset: req.preset,
      intensity: req.intensity,
      compressTarget: req.compressTarget,
      seed: req.seed,
    };
    return [variantShorter(masked, opts), variantCohesive(masked, opts)];
  }
}
