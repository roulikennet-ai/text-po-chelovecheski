/* ============================================================================
   SenseReportScreen.tsx — E5 «Отчёт проверки смысла» (design.md §6).
   Сводка сверху, таблица по абзацам, блок 🔴 с действиями.
   ========================================================================== */

import { useMemo, useState } from 'react';
import { AlertTriangle, XOctagon, CheckCircle2, Repeat } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Chip, StatusChip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { computeDocumentMetrics } from '../core/validation';
import { clicheDensity } from '../core/cliches';
import { processParagraph } from '../core/pipeline';
import { LocalRuleEngine } from '../engines/localEngine';
import './SenseReportScreen.css';

export function SenseReportScreen() {
  const { project, runSettings, patchParagraph, logEvent, setUi, pushToast, dictionary } = useStore();
  const [showBadOnly, setShowBadOnly] = useState(false);

  const paragraphs = project?.paragraphs ?? [];
  const processed = paragraphs.filter((p) => p.sense);

  const summary = useMemo(() => {
    const totalFacts = processed.reduce((s, p) => s + (p.sense?.found ?? 0), 0);
    const keptFacts = processed.reduce((s, p) => s + (p.sense?.kept ?? 0), 0);
    const losses = processed.filter((p) => p.sense?.level === 'bad').length;
    const warnings = processed.filter((p) => p.sense?.level === 'warn').length;
    const ok = processed.filter((p) => p.sense?.level === 'ok').length;
    const changed = processed.filter((p) => p.current !== p.original).length;

    const srcCliches = clicheDensity(paragraphs.map((p) => p.original).join(' '));
    const dstCliches = clicheDensity(paragraphs.map((p) => p.current).join(' '));
    const clichesRemoved = Math.max(
      0,
      Math.round(((srcCliches - dstCliches) / Math.max(0.001, srcCliches)) * 100),
    );

    const listsBefore = paragraphs.filter((p) => p.blockKind === 'list-item').length;
    const metrics = computeDocumentMetrics(
      processed.map((p) => ({ original: p.original, result: p.current })),
      runSettings.preset,
    );

    return { totalFacts, keptFacts, losses, warnings, ok, changed, clichesRemoved, listsBefore, metrics };
  }, [processed, paragraphs, runSettings.preset]);

  const badParagraphs = processed.filter((p) => p.sense?.level === 'bad');
  const visible = showBadOnly ? processed.filter((p) => p.sense?.level !== 'ok') : processed;

  if (processed.length === 0) {
    return (
      <ScreenShell title="Отчёт проверки смысла" subtitle="Пока нечего проверять">
        <EmptyState
          illustration="no-edits"
          title="Обработайте текст, чтобы увидеть отчёт"
          description="Отчёт покажет, сколько фактов найдено в исходнике и сколько сохранено в результате."
          actions={
            <Button variant="primary" onClick={() => setUi({ screen: 'editor' })}>
              Вернуться к редактору
            </Button>
          }
        />
      </ScreenShell>
    );
  }

  const repeatBad = async () => {
    // Повтор проблемных абзацев всегда идёт локальными правилами:
    // предсказуемо и без расхода квоты облака.
    const engine = new LocalRuleEngine();
    for (const p of badParagraphs) {
      const res = await processParagraph(p, {
        preset: runSettings.preset,
        intensity: runSettings.intensity,
        compressTarget: runSettings.compressTarget,
        engine,
        dictionary,
      });
      patchParagraph(p.id, {
        current: res.paragraph.current,
        sense: res.paragraph.sense,
        status: res.paragraph.status,
        variants: res.paragraph.variants,
      });
    }
    logEvent({ event: 'batch-start', object: 'повтор проблемных', engine: runSettings.engine, param: `${badParagraphs.length} абз.`, result: 'ок' });
    pushToast({ kind: 'ok', message: 'Проблемные абзацы переписаны заново.' });
  };

  const acceptAnyway = (id: string) => {
    patchParagraph(id, { status: 'accepted', accepted: true });
    logEvent({ event: 'accept', object: `осознанно ${id.slice(-4)}`, engine: runSettings.engine, param: '🔴 принят', result: 'ок' });
    pushToast({ kind: 'warn', message: 'Абзац принят несмотря на потерю факта. Проверьте вручную.' });
  };

  return (
    <ScreenShell
      title="Отчёт проверки смысла"
      subtitle="Проверено машинно: числа, имена, ссылки, сила утверждений и клише"
      actions={
        <>
          <Button
            variant={showBadOnly ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowBadOnly((v) => !v)}
          >
            {showBadOnly ? 'Показать все' : 'Только проблемные'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setUi({ screen: 'export' })}>
            К экспорту
          </Button>
        </>
      }
    >
      {/* Сводка */}
      <div className="sense-summary">
        <div className="sense-stat">
          <span className="sense-stat__value">{processed.length}</span>
          <span className="sense-stat__label">абзацев проверено</span>
        </div>
        <div className="sense-stat">
          <span className="sense-stat__value">
            {summary.keptFacts}
            <span className="sense-stat__of">/{summary.totalFacts}</span>
          </span>
          <span className="sense-stat__label">фактов сохранено</span>
        </div>
        <div className="sense-stat">
          <span className={`sense-stat__value${summary.losses > 0 ? ' sense-stat__value--bad' : ''}`}>
            {summary.losses}
          </span>
          <span className="sense-stat__label">потерь</span>
        </div>
        <div className="sense-stat">
          <span className="sense-stat__value">{summary.changed}</span>
          <span className="sense-stat__label">изменено стилистически</span>
        </div>
        <div className="sense-stat">
          <span className="sense-stat__value">{summary.clichesRemoved}%</span>
          <span className="sense-stat__label">клише устранено</span>
        </div>
        <div className="sense-stat">
          <span
            className={`sense-stat__value${
              summary.metrics.total >= 75 ? ' sense-stat__value--ok' : ' sense-stat__value--warn'
            }`}
          >
            {summary.metrics.total}
          </span>
          <span className="sense-stat__label">индекс H (порог 75)</span>
        </div>
      </div>

      {/* Блок 🔴 (S11) */}
      {badParagraphs.length > 0 && (
        <div className="sense-bad">
          <div className="sense-bad__head">
            <XOctagon size={18} />
            <strong>{badParagraphs.length} абзацев с потерей фактов — экспорт заблокирован</strong>
          </div>
          {badParagraphs.map((p) => (
            <div key={p.id} className="sense-bad__item">
              <span className="sense-bad__num">Абзац {paragraphs.findIndex((x) => x.id === p.id) + 1}</span>
              <span className="sense-bad__msg">{p.sense?.issues[0]?.message}</span>
              <div className="sense-bad__actions">
                <Button size="sm" variant="secondary" onClick={() => acceptAnyway(p.id)}>
                  Принять осознанно
                </Button>
                <Button size="sm" variant="ghost" icon={<Repeat size={14} />} onClick={() => void repeatBad()}>
                  Повторить
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Таблица */}
      <div className="sense-table-wrap">
        <table className="sense-table">
          <thead>
            <tr>
              <th scope="col" className="sense-table__num">
                №
              </th>
              <th scope="col">Фактов найдено</th>
              <th scope="col">Сохранено</th>
              <th scope="col">Статус</th>
              <th scope="col">Что проверить</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const idx = paragraphs.findIndex((x) => x.id === p.id) + 1;
              const sense = p.sense!;
              return (
                <tr
                  key={p.id}
                  className={sense.level === 'bad' ? 'sense-row--bad' : sense.level === 'warn' ? 'sense-row--warn' : ''}
                >
                  <td className="sense-table__num">{idx}</td>
                  <td className="sense-table__num">{sense.found}</td>
                  <td className="sense-table__num">{sense.kept}</td>
                  <td>
                    <StatusChip level={sense.level} />
                  </td>
                  <td className="sense-table__issues">
                    {sense.issues.length === 0 ? (
                      <span className="sense-table__clean">всё на месте</span>
                    ) : (
                      <ul>
                        {sense.issues.slice(0, 3).map((i, k) => (
                          <li key={k}>{i.message}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Метрики H */}
      <div className="sense-metrics">
        <h2 className="sense-metrics__title">Индекс человечности H</h2>
        <div className="sense-metrics__grid">
          {[
            { k: 'H1', label: 'Прозаичность', v: summary.metrics.h1 },
            { k: 'H2', label: 'Плотность клише', v: summary.metrics.h2 },
            { k: 'H3', label: 'Разнообразие ритма', v: summary.metrics.h3 },
            { k: 'H4', label: 'Связность', v: summary.metrics.h4 },
            { k: 'H5', label: 'Регистровая чистота', v: summary.metrics.h5 },
          ].map((m) => (
            <div key={m.k} className="sense-metric">
              <div className="sense-metric__head">
                <span className="sense-metric__name">
                  {m.k} · {m.label}
                </span>
                <span className="sense-metric__value">{m.v}</span>
              </div>
              <div className="sense-metric__bar">
                <div
                  className={`sense-metric__fill${m.v >= 75 ? '' : ' sense-metric__fill--low'}`}
                  style={{ width: `${m.v}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        {summary.metrics.total < 75 && (
          <p className="sense-metrics__hint">
            <AlertTriangle size={14} /> Индекс ниже порога 75. Попробуйте повысить уровень интенсивности или пресет F3.
          </p>
        )}
      </div>

      <div className="sense-foot">
        <Chip kind="neutral" icon={<CheckCircle2 size={12} />}>
          Проверка работает и в обратную сторону: новые факты и пояснения тоже ловятся
        </Chip>
      </div>
    </ScreenShell>
  );
}
