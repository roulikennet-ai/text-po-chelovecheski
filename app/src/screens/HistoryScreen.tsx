/* ============================================================================
   HistoryScreen.tsx — E8 «История проекта / версии» (design.md §6, S18).
   ========================================================================== */

import { useState } from 'react';
import { RotateCcw, Download, Clock } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { pagesOf } from '../core/paragraphs';
import type { Version } from '../core/types';
import './HistoryScreen.css';

const REASON_LABEL: Record<Version['reason'], string> = {
  launch: 'запуск обработки',
  export: 'экспорт',
  rollback: 'откат',
  manual: 'вручную',
};

export function HistoryScreen() {
  const { project, createSnapshot, restoreVersion, pushToast, logEvent, projects, setProject, deleteProject, setUi } =
    useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const versions = project?.versions ?? [];
  const chosen = versions.find((v) => v.id === selected);

  const doRollback = () => {
    if (!chosen || !project) return;
    createSnapshot('rollback', `Перед откатом к «${chosen.label}»`);
    restoreVersion(chosen.id);
    logEvent({ event: 'rollback', object: `проект ${project.id.slice(-4)}`, engine: '—', param: chosen.label, result: 'ок' });
    pushToast({ kind: 'ok', message: 'Версия восстановлена. Предыдущее состояние сохранено снимком.' });
    setRollbackOpen(false);
  };

  return (
    <ScreenShell
      title="История проекта и версии"
      subtitle="Снимок создаётся на запуск обработки, экспорт и откат"
      actions={
        <Button
          variant="secondary"
          size="sm"
          icon={<Clock size={16} />}
          onClick={() => {
            createSnapshot('manual', 'Ручной снимок');
            pushToast({ kind: 'ok', message: 'Снимок создан.' });
          }}
          disabled={!project}
        >
          Создать снимок
        </Button>
      }
    >
      {projects.length === 0 ? (
        <EmptyState
          illustration="history-empty"
          title="Проектов пока нет"
          description="Загрузите текст в редактор — проект появится здесь вместе с версиями."
        />
      ) : (
        <div className="hist">
          <aside className="hist__list">
            <h2 className="hist__list-title">Проекты</h2>
            {projects.map((p) => (
              <div key={p.id} className="hist-project-row">
                <button
                  className={`hist-project${project?.id === p.id ? ' hist-project--active' : ''}`}
                  onClick={() => {
                    setProject(p);
                    setSelected(null);
                    setUi({ screen: 'editor', viewMode: p.paragraphs.some((x) => x.status !== 'original') ? 'compare' : 'edit' });
                  }}
                >
                  <span className="hist-project__title">{p.title}</span>
                  <span className="hist-project__meta">
                    {new Date(p.updatedAt).toLocaleDateString('ru-RU')} ·{' '}
                    {pagesOf(p.paragraphs.reduce((s, x) => s + x.current.length, 0))} стр.
                  </span>
                </button>
                <button
                  className="hist-project__delete"
                  aria-label={`Удалить проект «${p.title}»`}
                  title="Удалить проект (профиль стиля сохранится)"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Удалить проект «${p.title}»? Профиль стиля останется.`)) {
                      deleteProject(p.id);
                      pushToast({ kind: 'info', message: 'Проект удалён, профиль стиля сохранён.' });
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </aside>

          <div className="hist__versions">
            {!project ? (
              <EmptyState compact title="Выберите проект" description="Слева — список ваших проектов." />
            ) : versions.length === 0 ? (
              <EmptyState
                compact
                illustration="history-empty"
                title="Версий ещё нет"
                description="Первая версия появится при запуске обработки."
              />
            ) : (
              <>
                <div className="hist__versions-head">
                  <h2 className="hist__list-title">Версии ({versions.length})</h2>
                </div>
                <ul className="hist-versions">
                  {[...versions].reverse().map((v) => (
                    <li key={v.id}>
                      <button
                        className={`hist-version${selected === v.id ? ' hist-version--active' : ''}`}
                        onClick={() => setSelected(v.id)}
                      >
                        <span className="hist-version__time">
                          {new Date(v.createdAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="hist-version__label">{v.label}</span>
                        <Chip kind={v.reason === 'rollback' ? 'warn' : 'neutral'}>{REASON_LABEL[v.reason]}</Chip>
                      </button>
                    </li>
                  ))}
                </ul>

                {chosen && (
                  <div className="hist-preview">
                    <div className="hist-preview__head">
                      <h3 className="hist-preview__title">Сравнение с текущим</h3>
                      <div className="hist-preview__actions">
                        <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={() => setRollbackOpen(true)}>
                          Откатить к этой версии
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Download size={14} />}
                          onClick={() => {
                            const text = chosen.paragraphs.map((p) => p.current).join('\n\n');
                            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `версия-${new Date(chosen.createdAt).toISOString().slice(0, 10)}.txt`;
                            a.click();
                          }}
                        >
                          Скачать TXT
                        </Button>
                      </div>
                    </div>
                    <div className="hist-diff">
                      {project.paragraphs.map((p) => {
                        const snap = chosen.paragraphs.find((s) => s.id === p.id);
                        const changed = snap && snap.current !== p.current;
                        if (!changed) return null;
                        return (
                          <div key={p.id} className="hist-diff__row">
                            <div className="hist-diff__cell hist-diff__cell--old">
                              <span className="hist-diff__tag">в версии</span>
                              {snap?.current}
                            </div>
                            <div className="hist-diff__cell hist-diff__cell--new">
                              <span className="hist-diff__tag">сейчас</span>
                              {p.current}
                            </div>
                          </div>
                        );
                      })}
                      {project.paragraphs.every((p) => {
                        const snap = chosen.paragraphs.find((s) => s.id === p.id);
                        return !snap || snap.current === p.current;
                      }) && <p className="hist-preview__same">Текущее состояние совпадает с этой версией.</p>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={rollbackOpen}
        title="Откатить к версии?"
        onClose={() => setRollbackOpen(false)}
        icon={<RotateCcw size={20} />}
        tone="warn"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRollbackOpen(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={doRollback}>
              Откатить
            </Button>
          </>
        }
      >
        <p>
          Текущее состояние будет сохранено отдельным снимком, поэтому откат можно отменить. Версия:{' '}
          <strong>{chosen?.label}</strong> от{' '}
          {chosen ? new Date(chosen.createdAt).toLocaleString('ru-RU') : ''}.
        </p>
      </Modal>
    </ScreenShell>
  );
}
