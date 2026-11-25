/* ============================================================================
   SettingsPanel.tsx — панель настроек E3 (design.md §6).
   Пресеты F1–F4, ползунок 1–5, счётчики, защита, движок, прогресс.
   ========================================================================== */

import { ChevronDown, ChevronRight, Cpu, Cloud, Shield, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import type { CompressTarget, PresetId, ProtectionClass } from '../../core/types';
import { PROTECTION_LABELS, protectionSummary } from '../../core/protection';
import { CHARS_PER_PAGE, pagesOf } from '../../core/paragraphs';
import { useStore } from '../../state/AppStore';
import { isCloudReady } from '../../engines';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { IntensitySlider } from '../ui/Slider';
import './SettingsPanel.css';

const PRESETS: Array<{ id: PresetId; code: string; name: string; hint: string }> = [
  { id: 'F1', code: 'F1', name: 'Научный, но читаемый', hint: 'Глава ВКР для руководителя' },
  { id: 'F2', code: 'F2', name: 'Сжатый', hint: 'Лимит объёма, автореферат' },
  { id: 'F3', code: 'F3', name: 'Проза вместо списков', hint: 'Там, где наделали списков' },
  { id: 'F4', code: 'F4', name: 'Для журнала', hint: 'Статья, популярный формат' },
];

const COMPRESS_OPTIONS: CompressTarget[] = [15, 30, 50];

export function SettingsPanel() {
  const { project, runSettings, setRunSettings, settings, batch, setUi, ui } = useStore();
  const [protectionOpen, setProtectionOpen] = useState(false);

  const paragraphs = project?.paragraphs ?? [];
  const totalChars = paragraphs.reduce((sum, p) => sum + p.current.length, 0);
  const pages = pagesOf(totalChars);

  const allSpans = paragraphs.flatMap((p) => p.protectedSpans);
  const summary = protectionSummary(allSpans);
  const summaryItems = (Object.keys(summary) as ProtectionClass[])
    .filter((k) => summary[k] > 0 && k !== 'manual')
    .map((k) => `${summary[k]} ${PROTECTION_LABELS[k]}`);

  const progress = batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0;
  const etaText =
    batch.running && batch.etaMs > 0
      ? batch.etaMs > 60000
        ? `~${Math.ceil(batch.etaMs / 60000)} мин`
        : `~${Math.ceil(batch.etaMs / 1000)} с`
      : '';

  return (
    <aside className="panel" aria-label="Настройки обработки">
      <div className="panel__scroll">
        {/* 1. Пресет подачи */}
        <section className="panel__section">
          <h3 className="panel__title">Режим подачи</h3>
          <div className="presets" role="radiogroup" aria-label="Режим подачи">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={runSettings.preset === p.id}
                className={`preset${runSettings.preset === p.id ? ' preset--active' : ''}`}
                onClick={() => setRunSettings({ preset: p.id })}
                title={p.hint}
              >
                <span className="preset__code">{p.code}</span>
                <span className="preset__body">
                  <span className="preset__name">{p.name}</span>
                  <span className="preset__hint">{p.hint}</span>
                </span>
                {runSettings.preset === p.id && <span className="preset__check">✓</span>}
              </button>
            ))}
          </div>

          {runSettings.preset === 'F2' && (
            <div className="compress">
              <span className="compress__label">Целевое сжатие</span>
              <div className="compress__options">
                {COMPRESS_OPTIONS.map((c) => (
                  <button
                    key={c}
                    className={`compress__opt${runSettings.compressTarget === c ? ' compress__opt--active' : ''}`}
                    onClick={() => setRunSettings({ compressTarget: c })}
                  >
                    −{c}%
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 2. Ползунок */}
        <section className="panel__section">
          <h3 className="panel__title">Интенсивность правок</h3>
          <IntensitySlider
            value={runSettings.intensity}
            onChange={(v) => setRunSettings({ intensity: v })}
            disabled={batch.running}
          />
        </section>

        {/* 3. Счётчики */}
        <section className="panel__section">
          <h3 className="panel__title">Объём</h3>
          <div className="counters">
            <div className="counter">
              <span className="counter__value">{totalChars.toLocaleString('ru-RU')}</span>
              <span className="counter__label">знаков</span>
            </div>
            <div className="counter">
              <span className="counter__value">{pages.toLocaleString('ru-RU')}</span>
              <span className="counter__label">стр. по {CHARS_PER_PAGE}</span>
            </div>
          </div>
        </section>

        {/* 4. Защита */}
        <section className="panel__section">
          <button
            className="panel__collapse"
            onClick={() => setProtectionOpen((v) => !v)}
            aria-expanded={protectionOpen}
          >
            <Shield size={16} />
            <span className="panel__title panel__title--inline">Защищено</span>
            <span className="panel__collapse-count">{allSpans.length}</span>
            {protectionOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>

          {summaryItems.length > 0 && (
            <p className="panel__summary">{summaryItems.join(' · ')}</p>
          )}

          {protectionOpen && (
            <div className="panel__protection">
              {allSpans.length === 0 ? (
                <p className="panel__muted">Пока ничего не защищено. Числа и имена защитятся автоматически при импорте.</p>
              ) : (
                <>
                  <div className="panel__chips">
                    {Array.from(new Set(allSpans.map((s) => s.text))).slice(0, 40).map((t, i) => (
                      <span key={`${t}-${i}`} className="protected-chip" title="Не изменится">
                        {t}
                      </span>
                    ))}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setUi({ screen: 'protection' })}>
                    Открыть управление защитой
                  </Button>
                </>
              )}
            </div>
          )}
        </section>

        {/* 5. Движок */}
        <section className="panel__section">
          <h3 className="panel__title">Движок</h3>
          <div className="engine-switch" role="radiogroup" aria-label="Движок">
            <button
              role="radio"
              aria-checked={runSettings.engine === 'local'}
              className={`engine-opt${runSettings.engine === 'local' ? ' engine-opt--active' : ''}`}
              onClick={() => setRunSettings({ engine: 'local', model: 'rules' })}
            >
              <Cpu size={16} />
              Локально
            </button>
            <button
              role="radio"
              aria-checked={runSettings.engine === 'cloud'}
              className={`engine-opt${runSettings.engine === 'cloud' ? ' engine-opt--active' : ''}`}
              onClick={() => setRunSettings({ engine: 'cloud', model: settings.cloudModel })}
              disabled={!settings.cloudAllowed}
              title={!settings.cloudAllowed ? 'Облако отключено в настройках' : undefined}
            >
              <Cloud size={16} />
              Облако
            </button>
          </div>
          {runSettings.engine === 'local' && (
            <>
              <p className="panel__muted">
                {settings.localEngine === 'gguf' && settings.localModelUrl
                  ? 'Локальная GGUF-модель. Без интернета, качество выше правил.'
                  : 'Правила, без интернета. Мгновенный отклик, среднее качество прозы.'}
              </p>
              <button className="panel__link" onClick={() => setUi({ screen: 'settings' })}>
                {settings.localEngine === 'gguf' && settings.localModelUrl
                  ? 'Настроить локальную модель…'
                  : 'Подключить локальную модель (GGUF)…'}
              </button>
            </>
          )}
          {runSettings.engine === 'cloud' && !isCloudReady(settings) && (
            <p className="panel__warn">
              <AlertTriangle size={14} /> {settings.cloudProvider === 'gigachat'
                ? 'GigaChat не настроен на сервере — обработка пойдёт локальными правилами.'
                : 'Не задан ключ API — обработка пойдёт локальными правилами.'}
            </p>
          )}
        </section>

        {/* 6. Прогресс */}
        {batch.total > 0 && (
          <section className="panel__section">
            <h3 className="panel__title">
              Обработка {batch.done} из {batch.total}
            </h3>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${batch.done} из ${batch.total} абзацев`}>
              <div className="progress__fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress__meta">
              <span>{progress}%</span>
              {etaText && <span>осталось {etaText}</span>}
              {batch.failed > 0 && <Chip kind="bad">{batch.failed} с ошибкой</Chip>}
            </div>
            <div className="progress__stripes" aria-hidden="true">
              {Array.from({ length: Math.min(batch.total, 120) }).map((_, i) => (
                <span
                  key={i}
                  className={`progress__stripe${
                    i < batch.done ? (i < batch.failed ? ' progress__stripe--fail' : ' progress__stripe--done') : ''
                  }`}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {ui.panelCollapsed && null}
    </aside>
  );
}
