/* ============================================================================
   AuditScreen.tsx — E11 «Журнал действий» (design.md §6, FR-SEC-4).
   Журнал НЕ содержит содержимого текстов — только метаданные и хэши.
   ========================================================================== */

import { useMemo, useState } from 'react';
import { Download, Trash2, Search, ShieldCheck } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Chip } from '../components/ui/Chip';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { downloadBlob } from '../core/exporters';
import type { AuditEvent } from '../core/types';
import './AuditScreen.css';

const EVENT_LABEL: Record<AuditEvent['event'], string> = {
  import: 'импорт',
  'batch-start': 'пакетная обработка',
  'batch-stop': 'остановка обработки',
  'spot-start': 'точечная правка',
  accept: 'принятие правки',
  reject: 'отклонение правки',
  'accept-all': 'принять всё',
  'reject-all': 'отклонить всё',
  'protection-change': 'изменение защиты',
  'style-profile-change': 'профиль стиля',
  export: 'экспорт',
  error: 'ошибка',
  rollback: 'откат к версии',
  settings: 'настройки',
};

/** Короткий хэш объекта — журнал не хранит текст (FR-SEC-4). */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

export function AuditScreen() {
  const { audit, clearAuditLog, pushToast, logEvent } = useStore();
  const [query, setQuery] = useState('');
  const [clearOpen, setClearOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...audit].reverse();
    if (!q) return list;
    return list.filter(
      (e) =>
        EVENT_LABEL[e.event].includes(q) ||
        e.object.toLowerCase().includes(q) ||
        e.param.toLowerCase().includes(q) ||
        e.result.toLowerCase().includes(q),
    );
  }, [audit, query]);

  const exportLog = () => {
    const header = 'время\tсобытие\tобъект\tдвижок\tпараметр\tрезультат\n';
    const rows = audit
      .map((e) =>
        [
          new Date(e.at).toISOString(),
          EVENT_LABEL[e.event],
          e.object,
          e.engine,
          e.param,
          e.result,
        ].join('\t'),
      )
      .join('\n');
    downloadBlob(`\uFEFF${header}${rows}`, 'журнал-действий.tsv', 'text/tab-separated-values;charset=utf-8');
    pushToast({ kind: 'ok', message: 'Журнал экспортирован.' });
  };

  return (
    <ScreenShell
      title="Журнал действий"
      subtitle="Аудит для себя: что и когда делало приложение. Содержимое текстов не записывается"
      actions={
        <>
          <Button variant="secondary" size="sm" icon={<Download size={16} />} onClick={exportLog} disabled={audit.length === 0}>
            Экспорт журнала
          </Button>
          <Button variant="danger" size="sm" icon={<Trash2 size={16} />} onClick={() => setClearOpen(true)} disabled={audit.length === 0}>
            Очистить
          </Button>
        </>
      }
    >
      <div className="audit-bar">
        <Field
          placeholder="Фильтр по событию, объекту или результату"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          icon={<Search size={16} />}
          aria-label="Фильтр журнала"
        />
        <Chip kind="neutral" icon={<ShieldCheck size={12} />}>
          {audit.length} записей
        </Chip>
      </div>

      {audit.length === 0 ? (
        <EmptyState
          illustration="history-empty"
          title="Журнал пуст"
          description="Здесь появятся записи об импорте, запусках, правках и экспорте."
        />
      ) : (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th scope="col">Время</th>
                <th scope="col">Событие</th>
                <th scope="col">Объект</th>
                <th scope="col">Движок</th>
                <th scope="col">Параметр</th>
                <th scope="col">Результат</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className={e.event === 'error' ? 'audit-row--error' : ''}>
                  <td className="audit-table__time">
                    {new Date(e.at).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td>{EVENT_LABEL[e.event]}</td>
                  <td className="audit-table__obj">
                    {e.object}
                    <span className="audit-table__hash" title="Хэш объекта: текст не хранится">
                      #{shortHash(e.object + e.param)}
                    </span>
                  </td>
                  <td>{e.engine === 'cloud' ? 'Облако' : e.engine === 'local' ? 'Локально' : '—'}</td>
                  <td className="audit-table__param">{e.param}</td>
                  <td>{e.result}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="audit-table__empty">
                    Ничего не найдено по фильтру.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={clearOpen}
        title="Очистить журнал?"
        onClose={() => setClearOpen(false)}
        icon={<Trash2 size={20} />}
        tone="bad"
        footer={
          <>
            <Button variant="secondary" onClick={() => setClearOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                clearAuditLog();
                setClearOpen(false);
                logEvent({ event: 'settings', object: 'журнал', engine: '—', param: 'очистка', result: 'ок' });
                pushToast({ kind: 'info', message: 'Журнал очищен.' });
              }}
            >
              Очистить журнал
            </Button>
          </>
        }
      >
        <p>Все записи журнала будут удалены. Проекты, версии и профиль стиля останутся.</p>
      </Modal>
    </ScreenShell>
  );
}
