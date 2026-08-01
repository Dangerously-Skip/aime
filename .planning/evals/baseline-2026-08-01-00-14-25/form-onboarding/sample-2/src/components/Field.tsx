import type { ReactNode } from "react";

export type FieldAria = {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
};

type Props = {
  /** Must match the react-hook-form field name so error links can find it. */
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  /** Rendered to the right of the label, e.g. a card brand badge. */
  adornment?: ReactNode;
  children: (aria: FieldAria) => ReactNode;
};

/**
 * Owns the label / hint / error wiring so no input can drift out of sync with
 * its own accessibility attributes.
 */
export default function Field({
  id,
  label,
  error,
  hint,
  optional,
  adornment,
  children,
}: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <div className="field__labelRow">
        <label className="field__label" htmlFor={id}>
          {label}
          {optional && <span className="field__optional"> (optional)</span>}
        </label>
        {adornment}
      </div>

      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}

      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}

      {error && (
        <p className="field__error" id={errorId}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v5M8 11.5v.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
