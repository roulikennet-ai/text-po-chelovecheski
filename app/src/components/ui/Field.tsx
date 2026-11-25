/* ============================================================================
   Field.tsx — поля ввода, поиск, выпадающие (design.md §5.5).
   ========================================================================== */

import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import './Field.css';

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, icon, id, className = '', ...rest },
  ref,
) {
  const fieldId = id ?? `f_${Math.random().toString(36).slice(2, 9)}`;
  return (
    <div className={`field ${className}`.trim()}>
      {label && (
        <label className="field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div className={`field__control${error ? ' field__control--error' : ''}${icon ? ' field__control--icon' : ''}`}>
        {icon && <span className="field__icon">{icon}</span>}
        <input ref={ref} id={fieldId} className="field__input" {...rest} />
      </div>
      {error ? (
        <span className="field__error">{error}</span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, id, className = '', ...rest },
  ref,
) {
  const fieldId = id ?? `ta_${Math.random().toString(36).slice(2, 9)}`;
  return (
    <div className={`field ${className}`.trim()}>
      {label && (
        <label className="field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <textarea ref={ref} id={fieldId} className="field__textarea" {...rest} />
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
});

export interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <label className={`toggle${disabled ? ' toggle--disabled' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`toggle__switch${checked ? ' toggle__switch--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__thumb" />
      </button>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {description && <span className="toggle__desc">{description}</span>}
      </span>
    </label>
  );
}
