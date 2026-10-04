"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { StepWelcome } from "./step-welcome";
import { StepProviders } from "./step-providers";
import { StepConnectors } from "./step-connectors";
import { StepDone } from "./step-done";

/**
 * Step order, single source of truth. Indices are derived from this list rather
 * than written as literals so that adding or removing a step can't leave an
 * off-by-N behind in the progress indicator or the skip link — which is exactly
 * what the old `step < TOTAL_STEPS - 2` skip condition encoded.
 *
 * There was a fifth step, "Help make this better", pointing at a feedback flag
 * in the sidebar that does nothing without a private widget key. Its one useful
 * sentence — where to report a bug — now sits on the Done step.
 */
const STEPS = ["welcome", "providers", "connectors", "done"] as const;
type StepId = (typeof STEPS)[number];

const TOTAL_STEPS = STEPS.length;

/**
 * Steps where the escape hatch DEFERS setup ("Skip setup for now" — come back
 * in a day). The Done step has none: its own buttons already finish, and a
 * second "Go to AIME" under "Continue" was the same action twice.
 *
 * No step is without a way out, though, and not only through its buttons:
 * onboarding sits in front of the whole app, and a "couldn't get past the
 * summary screen" report never reproduced — so Escape also leaves, deferring on
 * the setup steps and completing on Done. That exit does not depend on any
 * button receiving a click.
 */
const DEFERRABLE_STEPS: readonly StepId[] = ["welcome", "providers", "connectors"];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(
    useSettingsStore.getState().displayName || ""
  );
  const [connectedApps, setConnectedApps] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  const settingsStore = useSettingsStore();

  const next = useCallback(() => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1)), []);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);
  const goTo = useCallback((id: StepId) => setStep(STEPS.indexOf(id)), []);

  const handleSkip = useCallback(() => {
    settingsStore.setOnboardingSkippedAt(Date.now());
  }, [settingsStore]);

  const handleComplete = useCallback(() => {
    // Display name is the only thing this wizard owns; the provider step writes
    // its own credentials (settings + keychain) as it goes.
    if (displayName.trim()) {
      settingsStore.setDisplayName(displayName.trim());
    }
    settingsStore.setOnboardingComplete(true);
  }, [displayName, settingsStore]);

  const handleConnectorConnected = useCallback((connectorId: string) => {
    setConnectedApps((prev) =>
      prev.includes(connectorId) ? prev : [...prev, connectorId]
    );
  }, []);

  // Save the name on the step transition so it persists even if the user skips
  // the rest of the flow from a later step. The name is optional.
  const handleWelcomeContinue = useCallback(() => {
    if (displayName.trim()) {
      settingsStore.setDisplayName(displayName.trim());
    }
    next();
  }, [displayName, settingsStore, next]);

  const current: StepId = STEPS[step];
  const deferrable = DEFERRABLE_STEPS.includes(current);

  // Move focus into the new step, so keyboard and screen-reader users land on
  // it rather than on whatever the previous step left focused (often nothing).
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    // A field the step focused itself (the name input) keeps it.
    const active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return;
    root.querySelector<HTMLElement>("#onboarding-step-title")?.focus();
  }, [step]);

  /** Focus trap + Escape. A modal that lets Tab wander into the app behind it is not modal. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (deferrable) handleSkip();
      else handleComplete();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const progressLabel = `Step ${step + 1} of ${TOTAL_STEPS}`;

  return (
    /* The blurred backdrop and the scroll container are deliberately SEPARATE
       elements. Putting `backdrop-blur` and `overflow-y-auto` on the same node
       gives it a compositing context that Electron does not reliably
       invalidate when the card's height changes between steps: the previous,
       taller card's footprint stays painted as a grey block, and a stale layer
       like that can swallow pointer events — a button under it looks normal and
       does nothing. Blur stays on the static full-screen layer; only the inner
       wrapper scrolls. */
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      {/* Top-anchored, not vertically centred, and the card has a minimum
          height: a centred card of varying height moved its heading and
          buttons on every step. */}
      <div className="h-full overflow-y-auto flex items-start justify-center py-8 sm:pt-[8vh]">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-step-title"
          onKeyDown={onKeyDown}
          className="w-full max-w-[480px] mx-4"
        >
        {/* Progress — the dots are decoration; the text is what is announced. */}
        <div className="mb-6 flex flex-col items-center gap-2" data-testid="onboarding-progress">
          <div className="flex items-center justify-center gap-2" aria-hidden="true">
            {STEPS.map((id, i) => (
              <div
                key={id}
                data-testid="onboarding-step-dot"
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step
                    ? "w-6 bg-primary"
                    : i < step
                    ? "w-1.5 bg-primary/50"
                    : "w-1.5 bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            {progressLabel}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
          <div className="p-8 min-h-[30rem] flex flex-col">
            {current === "welcome" && (
              <StepWelcome
                displayName={displayName}
                onDisplayNameChange={setDisplayName}
                onContinue={handleWelcomeContinue}
              />
            )}
            {current === "providers" && (
              // Inference-provider setup: Anthropic BYOK / OpenRouter / local.
              // The step writes to the settings + provider stores itself.
              <StepProviders onContinue={next} onBack={prev} />
            )}
            {current === "connectors" && (
              <StepConnectors
                onConnectorConnected={handleConnectorConnected}
                onContinue={next}
                onBack={prev}
              />
            )}
            {current === "done" && (
              <StepDone
                displayName={displayName}
                connectedApps={connectedApps}
                onComplete={handleComplete}
                onConnectModel={() => goTo("providers")}
                onBack={prev}
              />
            )}
          </div>

          {deferrable && (
            <div className="px-8 pb-6 pt-0 text-center">
              <button
                type="button"
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip setup for now
              </button>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
