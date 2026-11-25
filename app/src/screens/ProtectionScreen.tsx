/* ============================================================================
   ProtectionScreen.tsx — E6 «Защищённые фрагменты» (design.md §6).
   Три источника защиты: авто, ручная, словарь проекта.
   ========================================================================== */

import { useMemo, useState } from 'react';
import { Shield, ShieldOff, Plus, Trash2, Info } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { ScreenShell } from './ScreenShell';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { Field } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { PROTECTION_LABELS, protectionSummary } from '../core/protection';
import type { ProtectionClass } from '../core/types';
import './ProtectionScreen.css';

const AUTO_CLASSES: ProtectionClass[] = ['number', 'name', 'abbr', 'latin', 'url', 'ref'];

const AUTO_DESCRIPTIONS: Record<string, string> = {
  number: 'Все числа, проценты, диапазоны, годы, «±»',
  name: 'Имена собственные и фамилии',
  abbr: 'Аббревиатуры (ВКР, ЧСС, РФ)',
  latin: 'Латинские включения и термины',
  url: 'Адреса сайтов',
  ref: 'Номера источников [12] и (Иванов, 2019)',
};

export function ProtectionScreen() {
  const { project, dictionary, setDictionary, logEvent, pushToast, updateProject } = useStore();
  const [newTerm, setNewTerm] = useState('');
  const [disabled, setDisabled] = useState<Set<ProtectionClass>>(new Set());
  const [confirmUnprotect, setConfirmUnprotect] = useState<{ text: string; cls: ProtectionClass } | null>(null);

  const paragraphs = project?.paragraphs ?? [];
  const allSpans = useMemo(() => paragraphs.flatMap((p) => p.protectedSpans), [paragraphs]);
  const summary = protectionSummary(allSpans);

  const manualSpans = allSpans.filter((s) => s.cls === 'manual');
  const dictSpans = allSpans.filter((s) => s.cls === 'dictionary');

  const removeSpan = (paragraphId: string, start: number, end: number) => {
    updateProject((p) => ({
      ...p,
      paragraphs: p.paragraphs.map((para) =>
        para.id === paragraphId
          ? { ...para, protectedSpans: para.protectedSpans.filter((s) => !(s.start === start && s.end === end)) }
          : para,
      ),
    }));
    logEvent({ event: 'protection-change', object: `абзац ${paragraphId.slice(-4)}`, engine: '—', param: 'снята ручная', result: 'ок' });
  };

  const addTerm = () => {
    const t = newTerm.trim();
    if (t.length < 2) return;
    if (dictionary.includes(t)) {
      pushToast({ kind: 'info', message: 'Такой термин уже в словаре.' });
      return;
    }
    setDictionary([...dictionary, t]);
    setNewTerm('');
    logEvent({ event: 'protection-change', object: 'словарь', engine: '—', param: `добавлен «${t}»`, result: 'ок' });
    pushToast({ kind: 'ok', message: `«${t}» добавлен в словарь проекта и не будет изменяться.` });
  };

  const removeTerm = (t: string) => {
    setDictionary(dictionary.filter((x) => x !== t));
    logEvent({ event: 'protection-change', object: 'словарь', engine: '—', param: `удалён «${t}»`, result: 'ок' });
  };

  const toggleAutoClass = (cls: ProtectionClass) => {
    const next = new Set(disabled);
    if (next.has(cls)) {
      next.delete(cls);
    } else {
      next.add(cls);
      const sample = allSpans.find((s) => s.cls === cls);
      if (sample) setConfirmUnprotect({ text: sample.text, cls });
    }
    setDisabled(next);
  };

  if (paragraphs.length === 0) {
    return (
      <ScreenShell title="Защищённые фрагменты" subtitle="Числа, имена и термины, которые нельзя менять">
        <EmptyState
          illustration="doc-empty"
          title="Пока нечего защищать"
          description="Загрузите текст — числа, имена, аббревиатуры и ссылки защитятся автоматически."
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title="Защищённые фрагменты"
      subtitle="Эти фрагменты физически не попадают в пересказ: они изымаются и возвращаются дословно"
    >
      <div className="prot-grid">
        {/* Авто */}
        <section className="prot-card">
          <div className="prot-card__head">
            <Shield size={18} />
            <h2 className="prot-card__title">Автоматическая защита</h2>
            <Chip kind="accent">{allSpans.filter((s) => s.cls !== 'manual' && s.cls !== 'dictionary').length}</Chip>
          </div>
          <p className="prot-card__desc">
            Защита включена по умолчанию. Снятие требует подтверждения — приложение покажет конкретное значение.
          </p>
          <div className="prot-classes">
            {AUTO_CLASSES.map((cls) => (
              <div key={cls} className={`prot-class${disabled.has(cls) ? ' prot-class--off' : ''}`}>
                <div className="prot-class__info">
                  <span className="prot-class__name">
                    {PROTECTION_LABELS[cls]}
                    <span className="prot-class__count">{summary[cls]}</span>
                  </span>
                  <span className="prot-class__desc">{AUTO_DESCRIPTIONS[cls]}</span>
                </div>
                <Button
                  size="sm"
                  variant={disabled.has(cls) ? 'secondary' : 'ghost'}
                  icon={disabled.has(cls) ? <ShieldOff size={14} /> : <Shield size={14} />}
                  onClick={() => toggleAutoClass(cls)}
                >
                  {disabled.has(cls) ? 'Включить' : 'Снять'}
                </Button>
              </div>
            ))}
          </div>
        </section>

        {/* Ручная */}
        <section className="prot-card">
          <div className="prot-card__head">
            <Shield size={18} />
            <h2 className="prot-card__title">Ручная защита</h2>
            <Chip kind="neutral">{manualSpans.length}</Chip>
          </div>
          <p className="prot-card__desc">
            Выделите фрагмент в тексте и нажмите «Не трогать» — он подсветится и не изменится при обработке.
          </p>
          {manualSpans.length === 0 ? (
            <p className="prot-empty">Пока ничего не защищено вручную.</p>
          ) : (
            <ul className="prot-list">
              {manualSpans.map((s, i) => {
                const owner = paragraphs.find((p) => p.protectedSpans.includes(s));
                return (
                  <li key={`${s.text}-${i}`} className="prot-list__item">
                    <span className="prot-chip">{s.text}</span>
                    <button
                      className="prot-list__remove"
                      onClick={() => owner && removeSpan(owner.id, s.start, s.end)}
                      aria-label={`Снять защиту с «${s.text}»`}
                      title="Снять защиту"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Словарь */}
        <section className="prot-card prot-card--wide">
          <div className="prot-card__head">
            <Shield size={18} />
            <h2 className="prot-card__title">Словарь проекта</h2>
            <Chip kind="neutral">{dictionary.length}</Chip>
          </div>
          <p className="prot-card__desc">
            Устойчивые термины автора: названия упражнений, тесты, методики. Наследуется между проектами и защищается дословно.
          </p>
          <div className="prot-add">
            <Field
              placeholder="Например: тест Купера, проба Ромберга"
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTerm()}
              label="Добавить термин"
            />
            <Button variant="secondary" icon={<Plus size={16} />} onClick={addTerm} disabled={newTerm.trim().length < 2}>
              Добавить
            </Button>
          </div>
          {dictionary.length === 0 ? (
            <p className="prot-empty">Словарь пуст. Добавьте термины, которые модель не должна переписывать.</p>
          ) : (
            <div className="prot-terms">
              {dictionary.map((t) => (
                <span key={t} className="prot-term">
                  {t}
                  <button className="prot-term__x" onClick={() => removeTerm(t)} aria-label={`Удалить «${t}»`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {dictSpans.length > 0 && (
            <p className="prot-card__note">
              <Info size={14} /> Найдено в тексте: {dictSpans.length} вхождений из словаря.
            </p>
          )}
        </section>
      </div>

      {/* Подтверждение снятия авто-защиты (FR-3.3) */}
      <Modal
        open={Boolean(confirmUnprotect)}
        title="Снять автоматическую защиту?"
        onClose={() => setConfirmUnprotect(null)}
        icon={<ShieldOff size={20} />}
        tone="warn"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmUnprotect(null)}>
              Оставить защиту
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmUnprotect(null);
                pushToast({
                  kind: 'warn',
                  message: `Класс «${confirmUnprotect ? PROTECTION_LABELS[confirmUnprotect.cls] : ''}» больше не защищается автоматически.`,
                });
              }}
            >
              Разрешить изменение
            </Button>
          </>
        }
      >
        <p>
          Вы разрешаете изменить значение <strong>«{confirmUnprotect?.text}»</strong>. Это может привести к искажению
          факта — отчёт проверки смысла отметит такие абзацы.
        </p>
      </Modal>
    </ScreenShell>
  );
}
