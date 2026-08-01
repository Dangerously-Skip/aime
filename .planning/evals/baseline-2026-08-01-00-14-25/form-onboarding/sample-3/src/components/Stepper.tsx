import { STEPS, type StepId } from '../types';

interface StepperProps {
  current: number;
  /** Highest index the user is allowed to jump to. */
  reachable: number;
  onJump: (id: StepId) => void;
}

export function Stepper({ current, reachable, onJump }: StepperProps) {
  const pct = STEPS.length > 1 ? (current / (STEPS.length - 1)) * 100 : 0;

  return (
    <nav className="stepper" aria-label="Setup progress">
      <div className="stepper__track" aria-hidden="true">
        <div className="stepper__fill" style={{ width: `${pct}%` }} />
      </div>

      <ol className="stepper__list">
        {STEPS.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          const canJump = i <= reachable && i !== current;
          return (
            <li key={s.id} className={`stepper__item stepper__item--${state}`}>
              <button
                type="button"
                className="stepper__button"
                onClick={() => canJump && onJump(s.id)}
                disabled={!canJump}
                aria-current={i === current ? 'step' : undefined}
              >
                <span className="stepper__marker" aria-hidden="true">
                  {state === 'done' ? (
                    <svg viewBox="0 0 16 16" width="12" height="12">
                      <path
                        d="M3.5 8.5l3 3 6-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="stepper__text">
                  <span className="stepper__index">Step {i + 1}</span>
                  <span className="stepper__title">{s.title}</span>
                </span>
                {state === 'done' && <span className="sr-only"> — completed</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
