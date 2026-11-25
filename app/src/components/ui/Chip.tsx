/* ============================================================================
   Chip.tsx — чипы и бейджи (design.md §5.6).
   ========================================================================== */

import type { ReactNode } from 'react';
import './Chip.css';

export type ChipKind = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

export interface ChipProps {
  kind?: ChipKind;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}

export function Chip({ kind = 'neutral', icon, children, title }: ChipProps) {
  return (
    <span className={`chip chip--${kind}`} title={title}>
      {icon && <span className="chip__icon">{icon}</span>}
      {children}
    </span>
  );
}

export interface StatusChipProps {
  level: 'ok' | 'warn' | 'bad';
  label?: string;
}

const STATUS_LABEL: Record<'ok' | 'warn' | 'bad', string> = {
  ok: 'сохранён',
  warn: 'внимание',
  bad: 'потеря',
};

/** Статус всегда: цвет + иконка + слово (design.md §2.3, доступность). */
export function StatusChip({ level, label }: StatusChipProps) {
  return (
    <Chip kind={level}>
      <span className={`status-dot status-dot--${level}`} aria-hidden="true" />
      {label ?? STATUS_LABEL[level]}
    </Chip>
  );
}
