"use client";

import { Sparkles } from "lucide-react";
import { APP_NAME } from "@/config/branding";

interface StepWelcomeProps {
  displayName: string;
  onDisplayNameChange: (name: string) => void;
  onContinue: () => void;
}

/**
 * The name is optional. Continue used to stay disabled until one was typed, so
 * the first thing the app did was refuse to let you in without a name it only
 * uses for a greeting.
 */
export function StepWelcome({
  displayName,
  onDisplayNameChange,
  onContinue,
}: StepWelcomeProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-5">
        <Sparkles className="h-7 w-7" strokeWidth={1.5} />
      </div>

      <h2 id="onboarding-step-title" tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
        Welcome to {APP_NAME}
      </h2>
      <p className="text-sm text-muted-foreground mt-2 mb-8">
        Let&apos;s get you set up. What should {APP_NAME} call you?
      </p>

      <div className="w-full max-w-xs">
        <label htmlFor="onboarding-name" className="sr-only">
          Your name (optional)
        </label>
        <input
          id="onboarding-name"
          type="text"
          placeholder="Your name (optional)"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onContinue();
          }}
          autoFocus
          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Continue
      </button>
    </div>
  );
}
