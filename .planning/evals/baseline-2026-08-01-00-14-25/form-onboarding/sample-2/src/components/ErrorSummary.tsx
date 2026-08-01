import { useEffect, useRef } from "react";
import type { ErrorItem } from "../errorList";

type Props = {
  items: ErrorItem[];
  /** Bumping this re-announces and re-focuses the summary on each failed attempt. */
  attempt: number;
};

/**
 * Shown after a failed submit. Screen readers get one announcement listing
 * every problem; sighted users get jump links straight to the offending field.
 */
export default function ErrorSummary({ items, attempt }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  useEffect(() => {
    if (items.length === 0 || attempt === seen.current) return;
    seen.current = attempt;
    ref.current?.focus();
  }, [attempt, items.length]);

  if (items.length === 0) return null;

  const focusField = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    (el as HTMLElement).focus({ preventScroll: true });
  };

  return (
    <div className="alert alert--error" role="alert" tabIndex={-1} ref={ref}>
      <p className="alert__title">
        {items.length === 1
          ? "There's one thing to fix before you continue"
          : `There are ${items.length} things to fix before you continue`}
      </p>
      <ul className="alert__list">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              onClick={(event) => {
                event.preventDefault();
                focusField(item.id);
              }}
            >
              {item.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
