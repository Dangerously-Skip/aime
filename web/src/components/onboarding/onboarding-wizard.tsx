"use client";

import { useState, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { getTeamById } from "@/config/teams";
import { StepWelcome } from "./step-welcome";
import { StepTeam } from "./step-team";
import { StepProviders } from "./step-providers";
import { getTeams } from "@/config/teams";
import { StepConnectors } from "./step-connectors";
import { StepDone } from "./step-done";
import { StepFeedback } from "./step-feedback";

const TOTAL_STEPS = 5;

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(
    useSettingsStore.getState().displayName || ""
  );
  const [teamId, setTeamId] = useState<string | null>(
    useSettingsStore.getState().teamId || null
  );
  const [manualApiKey, setManualApiKey] = useState("");
  const [connectedApps, setConnectedApps] = useState<string[]>([]);

  const settingsStore = useSettingsStore();

  const next = useCallback(() => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1)), []);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  const handleSkip = useCallback(() => {
    settingsStore.setOnboardingSkippedAt(Date.now());
  }, [settingsStore]);

  const handleComplete = useCallback(() => {
    // Save display name
    if (displayName.trim()) {
      settingsStore.setDisplayName(displayName.trim());
    }

    // Save team & API key
    if (teamId) {
      settingsStore.setTeamId(teamId);
      const team = getTeamById(teamId);
      if (team) {
        settingsStore.setAnthropicApiKey(team.key);
      }
    } else if (manualApiKey.trim()) {
      settingsStore.setAnthropicApiKey(manualApiKey.trim());
    }

    settingsStore.setOnboardingComplete(true);
  }, [displayName, teamId, manualApiKey, settingsStore]);

  const handleConnectorConnected = useCallback((connectorId: string) => {
    setConnectedApps((prev) =>
      prev.includes(connectorId) ? prev : [...prev, connectorId]
    );
  }, []);

  // Save name + team on step transitions (so they persist even if user skips later)
  const handleStep1Continue = useCallback(() => {
    if (displayName.trim()) {
      settingsStore.setDisplayName(displayName.trim());
    }
    next();
  }, [displayName, settingsStore, next]);

  const handleStep2Continue = useCallback(() => {
    if (teamId) {
      settingsStore.setTeamId(teamId);
      const team = getTeamById(teamId);
      if (team) {
        settingsStore.setAnthropicApiKey(team.key);
      }
    } else if (manualApiKey.trim()) {
      settingsStore.setAnthropicApiKey(manualApiKey.trim());
    }
    next();
  }, [teamId, manualApiKey, settingsStore, next]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-[480px] mx-4">
        {/* Step indicator dots */}
        <div className="flex items-center justify-center gap-2 mb-6">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
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
            {step === 0 && (
              <StepWelcome
                displayName={displayName}
                onDisplayNameChange={setDisplayName}
                onContinue={handleStep1Continue}
              />
            )}
            {step === 1 &&
              (getTeams().length > 0 ? (
                // Org build: a teams.json is configured, keep the team picker.
                <StepTeam
                  teamId={teamId}
                  onTeamChange={setTeamId}
                  manualApiKey={manualApiKey}
                  onManualApiKeyChange={setManualApiKey}
                  onContinue={handleStep2Continue}
                  onBack={prev}
                />
              ) : (
                // Open-source build: provider paths (P2 onboarding rework).
                // The step saves directly to settings/provider stores itself.
                <StepProviders onContinue={next} onBack={prev} />
              ))}
            {step === 2 && (
              <StepConnectors
                onConnectorConnected={handleConnectorConnected}
                onContinue={next}
                onBack={prev}
              />
            )}
            {step === 3 && (
              <StepDone
                displayName={displayName}
                teamId={teamId}
                connectedApps={connectedApps}
                onContinue={next}
                onBack={prev}
              />
            )}
            {step === 4 && (
              <StepFeedback
                onComplete={handleComplete}
                onBack={prev}
              />
            )}
          </div>

          {/* Skip link */}
          {step < TOTAL_STEPS - 2 && (
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
