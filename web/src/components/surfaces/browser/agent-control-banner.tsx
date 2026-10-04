"use client";

import { Bot, Hand, Square, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/config/branding";

/**
 * Says, over the page, that the agent is driving it — and hands the wheel back.
 *
 * The agent clicked and typed in a page the user was looking at with nothing on
 * the page itself to say so; the only sign was a phase label in the side panel.
 * Stop ends the run. Take over ends it too and puts focus in the page, so the
 * user carries on from exactly where the agent was.
 *
 * At the step limit the same bar asks whether to continue, instead of the run
 * ending silently at step 25.
 */
export function AgentControlBanner({
  stepLimit,
  onStop,
  onTakeOver,
  onContinue,
}: {
  /** Steps taken when the limit was hit, or null while running normally. */
  stepLimit: number | null;
  onStop: () => void;
  onTakeOver: () => void;
  onContinue: () => void;
}) {
  return (
    <div
      role="status"
      className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-1.5 text-xs backdrop-blur-sm"
    >
      <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="flex-1 min-w-0 truncate font-medium">
        {stepLimit !== null
          ? `Step limit reached (${stepLimit} steps) — continue?`
          : `${APP_NAME} is controlling this page`}
      </span>
      {stepLimit !== null ? (
        <>
          <Button size="sm" className="h-6 px-2 text-xs" onClick={onContinue}>
            <Play className="mr-1 h-3 w-3" />
            Continue
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onStop}>
            <Square className="mr-1 h-3 w-3" />
            Stop
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onStop}>
            <Square className="mr-1 h-3 w-3" />
            Stop
          </Button>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onTakeOver}>
            <Hand className="mr-1 h-3 w-3" />
            Take over
          </Button>
        </>
      )}
    </div>
  );
}
