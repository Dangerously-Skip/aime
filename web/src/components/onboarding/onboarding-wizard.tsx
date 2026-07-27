"use client";

import { useState, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
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
 * "Skip for now" only makes sense while there is setup left to skip. The summary
 * and feedback steps are the tail of the flow, so they show no skip link.
 */
const SKIPPABLE_STEPS: readonly StepId[] = ["welcome", "providers", "connectors"];

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
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

          {/* Skip link */}
          {SKIPPABLE_STEPS.includes(current) && (
            <div className="px-8 pb-6 pt-0 text-center">
              <button
                onClick={handleSkip}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip for now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
