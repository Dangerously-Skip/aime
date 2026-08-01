import type { CSSProperties } from "react";

export type StepMeta = {
  id: string;
  title: string;
  /** Two or three words shown under the step title in the stepper. */
  summary: string;
  /** Longer description shown in the step header. */
  blurb: string;
};

type Props = {
  steps: readonly StepMeta[];
  current: number;
  /** Highest step reached, so completed steps stay reachable but future ones don't. */
  furthest: number;
  onNavigate: (index: number) => void;
};

export default function ProgressStepper({ steps, current, furthest, onNavigate }: Props) {
  const fill = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 100;

  return (
    <nav className="stepper" aria-label="Setup progress">
      <div className="stepper__meta">
        <p className="stepper__count">
          Step {current + 1} of {steps.length}
        </p>
        <p className="stepper__pct">{Math.round((current / steps.length) * 100)}% complete</p>
      </div>

      <div
        className="stepper__bar"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={current + 1}
        aria-valuetext={`Step ${current + 1} of ${steps.length}: ${steps[current].title}`}
      >
        <div className="stepper__barFill" style={{ width: `${fill}%` }} />
      </div>

      <ol className="stepper__list" style={{ "--steps": steps.length } as CSSProperties}>
        <div className="stepper__track" aria-hidden="true">
          <div className="stepper__trackFill" style={{ width: `${fill}%` }} />
        </div>

        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          const reachable = index < current || (index <= furthest && index !== current);

          const inner = (
            <>
              <span className="stepper__dot" aria-hidden="true">
                {state === "done" ? (
                  <svg viewBox="0 0 16 16" focusable="false">
                    <path
                      d="M3.5 8.5l3 3 6-6.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="stepper__text">
                <span className="stepper__title">{step.title}</span>
                <span className="stepper__summary">{step.summary}</span>
              </span>
            </>
          );

          return (
            <li
              key={step.id}
              className={`stepper__item stepper__item--${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              {reachable ? (
                <button type="button" className="stepper__button" onClick={() => onNavigate(index)}>
                  {inner}
                  <span className="sr-only"> — completed, go back to edit</span>
                </button>
              ) : (
                <span className="stepper__button stepper__button--static">{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
