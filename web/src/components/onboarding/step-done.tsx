"use client";

import { getTeamById } from "@/config/teams";
import { ArrowLeft, PartyPopper, Check } from "lucide-react";

interface StepDoneProps {
  displayName: string;
  teamId: string | null;
  connectedApps: string[];
  onComplete: () => void;
  onBack: () => void;
}

export function StepDone({
  displayName,
  teamId,
  connectedApps,
  onComplete,
  onBack,
}: StepDoneProps) {
  const team = teamId ? getTeamById(teamId) : null;

  const summaryItems: { label: string; value: string }[] = [];

  if (displayName.trim()) {
    summaryItems.push({ label: "Name", value: displayName.trim() });
  }
  if (team) {
    summaryItems.push({ label: "Team", value: team.name });
  }
  if (connectedApps.length > 0) {
    summaryItems.push({
      label: "Connected",
      value: connectedApps
        .map((id) => id.charAt(0).toUpperCase() + id.slice(1))
        .join(", "),
    });
  }

  return (
    <div className="flex flex-col items-center text-center">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4 self-start"
      >
        <ArrowLeft className="h-3 w-3" />
        Back
      </button>

      <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-green-500/10 text-green-600 dark:text-green-400 mb-5">
        <PartyPopper className="h-7 w-7" strokeWidth={1.5} />
      </div>

      <h2 className="text-xl font-semibold tracking-tight">You&apos;re all set!</h2>
      <p className="text-sm text-muted-foreground mt-2 mb-6">
        Here&apos;s a summary of your setup
      </p>

      {summaryItems.length > 0 && (
        <div className="w-full max-w-xs mb-6 space-y-2">
          {summaryItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left"
            >
              <Check className="h-4 w-4 text-green-500 shrink-0" />
              <div className="min-w-0">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <p className="text-sm font-medium truncate">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onComplete}
        className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Get started
      </button>
    </div>
  );
}
