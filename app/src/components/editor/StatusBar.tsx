/* ============================================================================
   StatusBar.tsx — статус-бар E1 (design.md §5.12).
   Знаки · страницы · правки · движок · автосохранение · ETA
   ========================================================================== */

import { Check, Cloud, Cpu, Loader2, Pause } from 'lucide-react';
import { useStore } from '../../state/AppStore';
import { pagesOf, CHARS_PER_PAGE } from '../../core/paragraphs';
import './StatusBar.css';

export function StatusBar() {
  const { project, runSettings, saving, lastSavedAt, batch } = useStore();
  const paragraphs = project?.paragraphs ?? [];
  const chars = paragraphs.reduce((sum, p) => sum + p.current.length, 0);
  const pages = pagesOf(chars);

  const accepted = paragraphs.filter((p) => p.status === 'accepted').length;
  const rejected = paragraphs.filter((p) => p.status === 'rejected').length;
  const pending = paragraphs.filter((p) => p.status === 'processed' || p.status === 'warning' || p.status === 'error').length;

  const savedText = saving
    ? 'Сохранение…'
    : lastSavedAt
      ? `Сохранено ${new Date(lastSavedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
      : 'Не сохранено';

  const eta =
    batch.running && batch.etaMs > 0
      ? batch.etaMs > 60000
        ? `${Math.ceil(batch.etaMs / 60000)} мин`
        : `${Math.ceil(batch.etaMs / 1000)} с`
      : '';

  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <span>{chars.toLocaleString('ru-RU')} знаков</span>
        <span className="statusbar__sep" />
        <span title={`Страница = ${CHARS_PER_PAGE} знаков`}>{pages.toLocaleString('ru-RU')} стр.</span>
      </div>

      <div className="statusbar__group">
        <span>Правки: принято {accepted} · отклонено {rejected}</span>
        {pending > 0 && (
          <>
            <span className="statusbar__sep" />
            <span className="statusbar__pending">{pending} на разборе</span>
          </>
        )}
      </div>

      <div className="statusbar__spacer" />

      {batch.running && (
        <div className="statusbar__group">
          {batch.paused ? <Pause size={12} className="statusbar__paused" /> : <Loader2 size={12} className="statusbar__spin" />}
          <span>
            {batch.done}/{batch.total}
          </span>
          {batch.paused ? <span className="statusbar__paused">пауза</span> : eta && <span>· ETA {eta}</span>}
        </div>
      )}

      <div className="statusbar__group">
        {runSettings.engine === 'cloud' ? <Cloud size={12} /> : <Cpu size={12} />}
        <span>{runSettings.engine === 'cloud' ? 'Облако' : 'Локально'}</span>
      </div>

      <div className="statusbar__group">
        {saving ? (
          <Loader2 size={12} className="statusbar__spin" />
        ) : lastSavedAt ? (
          <Check size={12} className="statusbar__ok" />
        ) : null}
        <span>{savedText}</span>
      </div>
    </footer>
  );
}
