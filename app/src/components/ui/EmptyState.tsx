/* ============================================================================
   EmptyState.tsx — пустые состояния (S1, S15, S16) с 2D-иллюстрациями.
   Иллюстрации — собственная плоская графика в палитре проекта
   (design.md §8.2: контур --ink, одна заливка --accent).
   ========================================================================== */

import type { ReactNode } from 'react';
import './EmptyState.css';

export type IllustrationId = 'doc-empty' | 'no-edits' | 'style-profile' | 'offline-local' | 'history-empty' | 'cloud-consent';

function Illustration({ id }: { id: IllustrationId }) {
  const common = {
    width: 220,
    height: 150,
    viewBox: '0 0 220 150',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
    className: 'empty__art',
  } as const;

  switch (id) {
    case 'doc-empty':
      return (
        <svg {...common}>
          <rect x="62" y="22" width="96" height="112" rx="6" stroke="var(--ink)" strokeWidth="2" fill="var(--surface)" />
          <path d="M78 46h52M78 62h64M78 78h44M78 94h58" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
          <rect x="78" y="46" width="52" height="5" rx="2.5" fill="var(--accent)" opacity="0.85" />
          <path d="M166 44v34" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
          <path d="M160 72l6 8 6-8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M40 118h140" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'no-edits':
      return (
        <svg {...common}>
          <rect x="46" y="30" width="100" height="96" rx="6" stroke="var(--ink)" strokeWidth="2" fill="var(--surface)" />
          <path d="M62 54h60M62 70h68M62 86h48" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="150" cy="92" r="26" stroke="var(--accent)" strokeWidth="2.5" fill="var(--surface)" />
          <path d="M169 111l16 16" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M139 92l7 7 13-13" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'style-profile':
      return (
        <svg {...common}>
          <rect x="34" y="40" width="76" height="80" rx="6" stroke="var(--ink)" strokeWidth="2" fill="var(--surface)" />
          <path d="M48 60h44M48 74h48M48 88h30" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="146" cy="58" r="16" stroke="var(--accent)" strokeWidth="2" fill="var(--accent-soft)" />
          <circle cx="172" cy="86" r="11" stroke="var(--accent)" strokeWidth="2" fill="none" />
          <circle cx="132" cy="100" r="8" stroke="var(--ink)" strokeWidth="2" fill="none" />
          <path d="M112 72l14-8M136 70l10 8M148 98l12-6" stroke="var(--line-strong)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'offline-local':
      return (
        <svg {...common}>
          <rect x="76" y="46" width="68" height="58" rx="6" stroke="var(--ink)" strokeWidth="2" fill="var(--surface)" />
          <rect x="92" y="64" width="36" height="24" rx="3" stroke="var(--accent)" strokeWidth="2" fill="var(--accent-soft)" />
          <path d="M84 40v-8M110 40v-8M136 40v-8" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
          <path d="M62 122h96" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
          <path d="M160 108l6-6 6 6M166 102v16" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'history-empty':
      return (
        <svg {...common}>
          <rect x="52" y="34" width="84" height="98" rx="6" stroke="var(--ink)" strokeWidth="2" fill="var(--surface)" />
          <rect x="66" y="22" width="84" height="98" rx="6" stroke="var(--line-strong)" strokeWidth="2" fill="var(--surface)" />
          <path d="M82 44h52M82 60h44M82 76h36" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
          <path d="M120 104h44" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case 'cloud-consent':
      return (
        <svg {...common}>
          <rect x="40" y="44" width="56" height="72" rx="5" stroke="var(--ink)" strokeWidth="2" fill="var(--surface)" />
          <path d="M52 60h32M52 74h36M52 88h24" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" />
          <path d="M104 84h32a14 14 0 0 0 0-28 18 18 0 0 0-34-4 12 12 0 0 0 2 32z" stroke="var(--accent)" strokeWidth="2" fill="var(--accent-soft)" />
          <path d="M126 66v22M118 74l8-8 8 8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M168 50l4 8 8 1-6 6 2 8-8-4-8 4 2-8-6-6 8-1z" stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
        </svg>
      );
    default:
      return null;
  }
}

export interface EmptyStateProps {
  illustration?: IllustrationId;
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ illustration, title, description, actions, compact }: EmptyStateProps) {
  return (
    <div className={`empty${compact ? ' empty--compact' : ''}`}>
      {illustration && <Illustration id={illustration} />}
      <h3 className="empty__title">{title}</h3>
      {description && <p className="empty__desc">{description}</p>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  );
}
