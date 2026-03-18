"use client";

import { useState, useEffect } from "react";
import { getTeams, type TeamConfig } from "@/config/teams";
import { Check, ArrowLeft, KeyRound } from "lucide-react";

interface StepTeamProps {
  teamId: string | null;
  onTeamChange: (id: string | null) => void;
  manualApiKey: string;
  onManualApiKeyChange: (key: string) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function StepTeam({
  teamId,
  onTeamChange,
  manualApiKey,
  onManualApiKeyChange,
  onContinue,
  onBack,
}: StepTeamProps) {
  const [teams, setTeams] = useState<TeamConfig[]>([]);

  useEffect(() => {
    setTeams(getTeams());
  }, []);

  const hasTeams = teams.length > 0;
  const canContinue = hasTeams ? !!teamId : manualApiKey.trim().length > 0;

  return (
    <div className="flex flex-col">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 self-start"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>

      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold tracking-tight">Select your team</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {hasTeams
            ? "This configures your AI access automatically"
            : "Enter your API key to get started"}
        </p>
      </div>

      {hasTeams ? (
        <div className="space-y-2 mb-6">
          {teams.map((team) => {
            const isSelected = teamId === team.id;
            return (
              <button
                key={team.id}
                onClick={() => onTeamChange(team.id)}
                className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-border/80 hover:bg-accent/30"
                }`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {team.name.charAt(0)}
                </div>
                <span className="flex-1 text-sm font-medium">{team.name}</span>
                {isSelected && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">API Key</span>
          </div>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={manualApiKey}
            onChange={(e) => onManualApiKeyChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canContinue) onContinue();
            }}
            autoFocus
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Get your key from the nib AI Studio portal
          </p>
        </div>
      )}

      <button
        onClick={onContinue}
        disabled={!canContinue}
        className="mx-auto inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
      >
        Continue
      </button>
    </div>
  );
}
