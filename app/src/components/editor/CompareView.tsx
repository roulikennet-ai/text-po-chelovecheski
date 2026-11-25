/* ============================================================================
   CompareView.tsx — E4 сравнение «было/стало» (design.md §4.3).
   Один вертикальный скролл, три ячейки в строке: исходник — действия —
   результат. Так абзацы всегда выровнены по строкам.
   ========================================================================== */

import { useEffect, useRef } from 'react';
import { Check, RefreshCw, X } from 'lucide-react';
import type { Paragraph } from '../../core/types';
import { StatusChip } from '../ui/Chip';
import './CompareView.css';

export interface CompareViewProps {
  paragraphs: Paragraph[];
  focusedId: string | null;
  onFocus: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onVariant: (id: string, variantIndex: number) => void;
  onRegenerate: (id: string) => void;
}

export function CompareView({ paragraphs, focusedId, onFocus, onAccept, onReject, onVariant, onRegenerate }: CompareViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // Переход к текущему абзацу при смене фокуса.
  useEffect(() => {
    if (!focusedId) return;
    const el = bodyRef.current?.querySelector(`[data-cmp-id="${focusedId}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusedId]);

  return (
    <div className="cmp">
      <div className="cmp__head">
        <span className="cmp__col-title">Было</span>
        <span className="cmp__col-title cmp__col-title--mid">Правка</span>
        <span className="cmp__col-title">Стало</span>
      </div>

      <div className="cmp__body" ref={bodyRef}>
        {paragraphs.map((p, i) => {
          const isProcessed = p.status !== 'original';
          const isAccepted = p.status === 'accepted';
          return (
            <div
              key={p.id}
              data-cmp-id={p.id}
              className={`cmp__row${focusedId === p.id ? ' cmp__row--focused' : ''}${
                isAccepted ? ' cmp__row--accepted' : ''
              }`}
              onClick={() => onFocus(p.id)}
            >
              {/* Исходник */}
              <div className="cmp__cell">
                <div className={`cmp__text cmp__text--${p.blockKind}`}>{p.original}</div>
              </div>

              {/* Действия */}
              <div className="cmp__gutter">
                <button className="cmp__gutter-num" onClick={() => onFocus(p.id)} aria-label={`Абзац ${i + 1}`}>
                  {i + 1}
                </button>
                {p.sense && <StatusChip level={p.sense.level} label="" />}
                {isProcessed && (
                  <div className="cmp__actions">
                    <button
                      className={`cmp__act${isAccepted ? ' cmp__act--on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAccept(p.id);
                      }}
                      aria-label="Принять"
                      title="Принять (Ctrl+Y)"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      className="cmp__act"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReject(p.id);
                      }}
                      aria-label="Отклонить"
                      title="Отклонить — вернуть исходный текст"
                    >
                      <X size={14} />
                    </button>
                    <button
                      className="cmp__act"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRegenerate(p.id);
                      }}
                      aria-label="Другой вариант"
                      title="Переписать заново"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Результат */}
              <div className="cmp__cell cmp__cell--result">
                <div className={`cmp__text cmp__text--${p.blockKind}`}>
                  {isProcessed ? p.current : <span className="cmp__unchanged">Без изменений</span>}
                </div>
                {p.variants.length > 1 && focusedId === p.id && (
                  <div className="cmp__variants">
                    {p.variants.map((v, vi) => (
                      <button
                        key={v.id}
                        className={`cmp__variant${p.current === v.text ? ' cmp__variant--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onVariant(p.id, vi);
                        }}
                        title={v.sense ? `Фактов сохранено: ${v.sense.kept} из ${v.sense.found}` : undefined}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
