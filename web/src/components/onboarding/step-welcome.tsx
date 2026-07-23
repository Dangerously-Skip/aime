"use client";

import { Sparkles } from "lucide-react";
import { APP_NAME } from "@/config/branding";

interface StepWelcomeProps {
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  onContinue: () => void;
}

export function StepWelcome({
  displayName,
  onDisplayNameChange,
  onContinue,
}: StepWelcomeProps) {
  const canContinue = displayName.trim().length > 0;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-5">
        <Sparkles className="h-7 w-7" strokeWidth={1.5} />
      </div>

      <h2 className="text-xl font-semibold tracking-tight">Welcome to {APP_NAME}</h2>
      <p className="text-sm text-muted-foreground mt-2 mb-8">
        Let&apos;s get you set up. What should we call you?
      </p>

      <div className="w-full max-w-xs">
        <input
          type="text"
          placeholder="Your name"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canContinue) onContinue();
          }}
          autoFocus
          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      <button
        onClick={onContinue}
        disabled={!canContinue}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
      >
        Continue
      </button>
    </div>
  );
}
