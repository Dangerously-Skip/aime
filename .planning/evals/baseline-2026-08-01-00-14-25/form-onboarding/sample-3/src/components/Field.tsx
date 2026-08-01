import type { ReactNode } from 'react';

export interface FieldChildProps {
  id: string;
  'aria-invalid': boolean | undefined;
  'aria-describedby': string | undefined;
}

interface FieldProps {
  /** Also the error-map path, e.g. `company.name`. */
  path: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  children: (props: FieldChildProps) => ReactNode;
}

/**
 * Owns the label/hint/error layout and the aria wiring, so every input in the
 * form is described and invalidated consistently. `aria-describedby` points at
 * the hint and the error together — screen readers read both.
 */
export function Field({ path, label, error, hint, optional, children }: FieldProps) {
  const id = `f-${path.replace(/\./g, '-')}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {optional && <span className="field__optional"> (optional)</span>}
      </label>
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {error && (
        <p className="field__error" id={errorId}>
          <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v4.2M8 11.2v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}
