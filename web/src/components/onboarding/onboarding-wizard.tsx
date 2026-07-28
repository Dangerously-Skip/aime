"use client";

import { useState, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { APP_NAME } from "@/config/branding";
import { StepWelcome } from "./step-welcome";
import { StepProviders } from "./step-providers";
import { StepConnectors } from "./step-connectors";
import { StepDone } from "./step-done";
import { StepFeedback } from "./step-feedback";

/**
 * Step order, single source of truth. Indices are derived from this list rather
 * than written as literals so that adding or removing a step can't leave an
 * off-by-N behind in the progress dots or the skip link — which is exactly what
 * the old `step < TOTAL_STEPS - 2` skip condition encoded.
 */
const STEPS = ["welcome", "providers", "connectors", "done", "feedback"] as const;
type StepId = (typeof STEPS)[number];

const TOTAL_STEPS = STEPS.length;

/**
 * Steps where the escape hatch DEFERS setup ("Skip for now" — come back in a day).
 *
 * Every other step gets an escape that COMPLETES instead, because by the tail of
 * the flow there is nothing left to defer. The point is that no step is ever
 * without a way out: onboarding sits in front of the whole app, so a step whose
 * primary button fails for any reason would otherwise lock the user out entirely
 * with only a Back button for company. That happened — a "couldn't get past the
 * summary screen" report which reproduced on neither Chromium nor Electron, so
 * the cause is still unknown and the trap is the part worth removing.
 */
const DEFERRABLE_STEPS: readonly StepId[] = ["welcome", "providers", "connectors"];

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(
    useSettingsStore.getState().displayName || ""
  );
  const [connectedApps, setConnectedApps] = useState<string[]>([]);

  const settingsStore = useSettingsStore();

  const next = useCallback(() => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1)), []);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

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
  // the rest of the flow from a later step.
  const handleWelcomeContinue = useCallback(() => {
    if (displayName.trim()) {
      settingsStore.setDisplayName(displayName.trim());
    }
    next();
  }, [displayName, settingsStore, next]);

  const current: StepId = STEPS[step];

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
      <div className="h-full overflow-y-auto flex items-center justify-center py-8">
        <div className="w-full max-w-[480px] mx-4">
        {/* Step indicator dots */}
        <div
          className="flex items-center justify-center gap-2 mb-6"
          data-testid="onboarding-progress"
        >
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

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
          <div className="p-8">
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
                onContinue={next}
                onBack={prev}
              />
            )}
            {current === "feedback" && (
              <StepFeedback onComplete={handleComplete} onBack={prev} />
            )}
          </div>

          {/* Escape hatch — present on EVERY step, so onboarding can never trap. */}
          <div className="px-8 pb-6 pt-0 text-center">
            {DEFERRABLE_STEPS.includes(current) ? (
              <button
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip for now
              </button>
            ) : (
              <button
                onClick={handleComplete}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Go to {APP_NAME}
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
