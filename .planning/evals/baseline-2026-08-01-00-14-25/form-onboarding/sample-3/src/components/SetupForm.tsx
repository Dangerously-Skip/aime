import { useEffect, useRef, useState } from 'react';
import { BillingStep } from '../steps/BillingStep';
import { CompanyStep } from '../steps/CompanyStep';
import { TeamStep } from '../steps/TeamStep';
import { PLANS, STEPS, type ErrorMap, type SetupData } from '../types';
import { useSetupForm } from '../useSetupForm';
import { Stepper } from './Stepper';

const STATIC_LABELS: Record<string, string> = {
  'company.name': 'Company name',
  'company.website': 'Website',
  'company.size': 'Company size',
  'company.country': 'Country',
  invites: 'Team invites',
  'billing.plan': 'Plan',
  'billing.cardName': 'Name on card',
  'billing.cardNumber': 'Card number',
  'billing.expiry': 'Expiry',
  'billing.cvc': 'Security code',
  'billing.billingEmail': 'Billing email',
};

function labelFor(path: string, data: SetupData): string {
  const inviteMatch = /^invites\.(.+)\.email$/.exec(path);
  if (inviteMatch) {
    const index = data.invites.findIndex((i) => i.id === inviteMatch[1]);
    return `Email address ${index >= 0 ? index + 1 : ''}`.trim();
  }
  return STATIC_LABELS[path] ?? path;
}

function domId(path: string): string {
  return `f-${path.replace(/\./g, '-')}`;
}

export function SetupForm() {
  const f = useSetupForm();
  const [showSummary, setShowSummary] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const [failures, setFailures] = useState(0);

  const step = STEPS[f.stepIndex];
  const isLast = f.stepIndex === STEPS.length - 1;
  const busy = f.status === 'submitting';

  // Move focus to the new step's heading so keyboard and screen-reader users
  // are not left at the bottom of the previous step.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [f.step]);

  // Declared after the heading effect so that on a failed submit — which can
  // change step *and* raise errors in one go — the summary wins the focus.
  useEffect(() => {
    if (failures > 0) summaryRef.current?.focus();
  }, [failures]);

  const summaryErrors: ErrorMap = showSummary ? f.visibleErrors : {};
  const summaryEntries = Object.entries(summaryErrors);

  async function handleContinue() {
    if (isLast) {
      const ok = await f.submit();
      if (!ok) {
        setShowSummary(true);
        setFailures((n) => n + 1);
      }
      return;
    }
    const moved = f.next();
    if (moved) {
      setShowSummary(false);
    } else {
      setShowSummary(true);
      setFailures((n) => n + 1);
    }
  }

  if (f.status === 'done') {
    const plan = PLANS.find((p) => p.id === f.data.billing.plan);
    const invited = f.data.invites.filter((i) => i.email.trim());
    return (
      <div className="card">
        <div className="done">
          <div className="done__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path
                d="M5 13l4.5 4.5L19 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="done__title">You are all set</h1>
          <p className="done__blurb">
            {f.data.company.name} is ready to go on the {plan?.name} plan.
            {invited.length > 0
              ? ` We have emailed ${invited.length} ${invited.length === 1 ? 'invite' : 'invites'}.`
              : ' You can invite your team whenever you like.'}
          </p>
          <dl className="done__meta">
            <dt>Account ID</dt>
            <dd className="mono">{f.accountId}</dd>
          </dl>
          <button type="button" className="btn btn--ghost" onClick={f.reset}>
            Set up another account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <Stepper current={f.stepIndex} reachable={f.furthestReachable} onJump={f.goTo} />

      {/* Announces step changes without stealing focus. */}
      <p className="sr-only" aria-live="polite">
        Step {f.stepIndex + 1} of {STEPS.length}: {step.title}
      </p>

      {f.restoredFromDraft && f.stepIndex === 0 && (
        <p className="banner banner--info">
          We restored your progress from last time. Card details need re-entering.
        </p>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleContinue();
        }}
      >
        <header className="step__header">
          <h1 className="step__title" tabIndex={-1} ref={headingRef}>
            {step.title}
          </h1>
          <p className="step__blurb">{step.blurb}</p>
        </header>

        {(summaryEntries.length > 0 || f.formError) && (
          <div
            className="summary"
            role="alert"
            tabIndex={-1}
            ref={summaryRef}
            aria-labelledby="summary-title"
          >
            <h2 className="summary__title" id="summary-title">
              {f.formError ??
                (summaryEntries.length === 1
                  ? 'There is one problem to fix'
                  : `There are ${summaryEntries.length} problems to fix`)}
            </h2>
            {summaryEntries.length > 0 && (
              <ul className="summary__list">
                {summaryEntries.map(([path, message]) => (
                  <li key={path}>
                    <a
                      href={`#${domId(path)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(domId(path))?.focus();
                      }}
                    >
                      <strong>{labelFor(path, f.data)}:</strong> {message}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <fieldset className="step__body" disabled={busy}>
          {f.step === 'company' && (
            <CompanyStep
              value={f.data.company}
              errors={f.visibleErrors}
              onChange={f.setCompanyField}
              onBlur={f.markTouched}
            />
          )}
          {f.step === 'team' && (
            <TeamStep
              invites={f.data.invites}
              errors={f.visibleErrors}
              onChange={f.setInviteField}
              onBlur={f.markTouched}
              onAdd={f.addInvite}
              onRemove={f.removeInvite}
            />
          )}
          {f.step === 'billing' && (
            <BillingStep
              value={f.data.billing}
              seats={Math.max(1, f.data.invites.filter((i) => i.email.trim()).length + 1)}
              errors={f.visibleErrors}
              onChange={f.setBillingField}
              onBlur={f.markTouched}
            />
          )}
        </fieldset>

        <footer className="actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={f.back}
            disabled={f.stepIndex === 0 || busy}
          >
            Back
          </button>

          <div className="actions__right">
            {f.step === 'team' && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setShowSummary(false);
                  f.next();
                }}
                disabled={busy}
              >
                Skip for now
              </button>
            )}
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy && <span className="spinner" aria-hidden="true" />}
              {isLast ? (busy ? 'Creating account…' : 'Finish setup') : 'Continue'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
