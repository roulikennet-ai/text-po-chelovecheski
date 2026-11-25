/* ============================================================================
   index.ts — фабрика движка по настройкам (FR-8.3.1): единая точка выбора
   локальных правил, OpenAI-совместимого облака или GigaChat через прокси.
   ========================================================================== */

import type { AppSettings, RunSettings } from '../core/types';
import type { Engine } from './engine';
import { CloudEngine } from './cloudEngine';
import { GigaChatEngine } from './gigachat';
import { GgufEngine } from './localModel';
import { LocalRuleEngine } from './localEngine';

/** Готов ли облачный провайдер к работе (без сетевых запросов). */
export function isCloudReady(settings: AppSettings): boolean {
  if (!settings.cloudAllowed) return false;
  if (settings.cloudProvider === 'gigachat') {
    // Ключ GigaChat живёт на сервере — фронтенд проверяет только прокси.
    return Boolean(settings.gigachatProxyUrl);
  }
  return Boolean(settings.apiKey);
}

/**
 * Создать движок для обработки. Если облако выбрано, но не готово,
 * возвращается локальный движок — контур не «умирает» (S12).
 */
export function createEngine(settings: AppSettings, runSettings: RunSettings): Engine {
  if (runSettings.engine !== 'cloud' || !isCloudReady(settings)) {
    // Локальный режим: правила или скачанная GGUF-модель.
    if (settings.localEngine === 'gguf' && settings.localModelUrl.trim()) {
      return new GgufEngine(settings.localModelUrl.trim());
    }
    return new LocalRuleEngine();
  }
  if (settings.cloudProvider === 'gigachat') {
    return new GigaChatEngine({
      proxyBase: settings.gigachatProxyUrl,
      model: settings.cloudModel,
      timeoutMs: 10000,
      clientId: settings.clientId,
      clientName: settings.userName.trim() || undefined,
    });
  }
  return new CloudEngine({
    baseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    model: settings.cloudModel,
    timeoutMs: 10000,
  });
}

export { GigaChatEngine, CloudEngine, LocalRuleEngine, GgufEngine };
