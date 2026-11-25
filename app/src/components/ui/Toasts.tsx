/* ============================================================================
   Toasts.tsx — тосты (design.md §5.11).
   ========================================================================== */

import { CheckCircle2, Info, AlertTriangle, XOctagon, X } from 'lucide-react';
import { useStore } from '../../state/AppStore';
import './Toasts.css';

const ICONS = {
  info: Info,
  ok: CheckCircle2,
  warn: AlertTriangle,
  bad: XOctagon,
};

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <Icon size={18} className="toast__icon" />
            <span className="toast__text">{t.message}</span>
            {t.actionLabel && t.action && (
              <button
                className="toast__action"
                onClick={() => {
                  t.action?.();
                  dismissToast(t.id);
                }}
              >
                {t.actionLabel}
              </button>
            )}
            <button className="toast__close" aria-label="Закрыть уведомление" onClick={() => dismissToast(t.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
