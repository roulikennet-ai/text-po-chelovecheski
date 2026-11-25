/* ============================================================================
   ScreenShell.tsx — общий каркас внутренних экранов E5–E11 (design.md §6).
   ========================================================================== */

import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../state/AppStore';
import { IconButton } from '../components/ui/Button';
import './ScreenShell.css';

export interface ScreenShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function ScreenShell({ title, subtitle, actions, children }: ScreenShellProps) {
  const { setUi } = useStore();
  return (
    <div className="shell">
      <div className="shell__head">
        <IconButton label="Вернуться к редактору" onClick={() => setUi({ screen: 'editor' })}>
          <ArrowLeft size={18} />
        </IconButton>
        <div className="shell__titles">
          <h1 className="shell__title">{title}</h1>
          {subtitle && <p className="shell__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="shell__actions">{actions}</div>}
      </div>
      <div className="shell__body">{children}</div>
    </div>
  );
}
