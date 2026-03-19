"use client";

import { ArrowLeft, Bug, Flag, Lightbulb } from "lucide-react";

interface StepFeedbackProps {
  onComplete: () => void;
  onBack: () => void;
}

export function StepFeedback({ onComplete, onBack }: StepFeedbackProps) {
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

      <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 text-primary mb-5">
        <Flag className="h-7 w-7" strokeWidth={1.5} />
      </div>

      <h2 className="text-xl font-semibold tracking-tight">Help make this better</h2>
      <p className="text-sm text-muted-foreground mt-2 mb-6 max-w-xs">
        We&apos;re building this together. Use the flag icon in the sidebar anytime to suggest features or report bugs.
      </p>

      <div className="w-full max-w-xs mb-6 space-y-2">
        <div className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left">
          <Lightbulb className="h-4 w-4 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Suggest a feature</p>
            <span className="text-xs text-muted-foreground">Got an idea? We&apos;d love to hear it.</span>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-2.5 text-left">
          <Bug className="h-4 w-4 text-red-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Report a bug</p>
            <span className="text-xs text-muted-foreground">Something off? Let us know so we can fix it.</span>
          </div>
        </div>
      </div>

      <button
        onClick={onComplete}
        className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Get started
      </button>
    </div>
  );
}
