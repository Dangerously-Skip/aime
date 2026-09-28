"use client";

import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/app-store";

/**
 * Shown instead of sending a turn when nothing is configured that could answer
 * it. Sending anyway produced a spinner, then an authentication error in
 * provider language — a dead end for exactly the person who has just installed
 * the app. `attempted` is set once a send was refused, so it is announced.
 */
export function NoModelCard({ attempted = false }: { attempted?: boolean }) {
  const openSettings = useAppStore((s) => s.openSettings);
  return (
    <div
      role={attempted ? "alert" : "note"}
      className={`mb-2 flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
        attempted ? "border-primary/40 bg-primary/5" : "border-border bg-muted/30"
      }`}
    >
      <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">No model is set up yet</p>
        <p className="text-xs text-muted-foreground">Add an API key or a provider so there is a model to answer.</p>
      </div>
      <Button size="sm" className="h-7 shrink-0 text-xs" onClick={() => openSettings("connectors")}>
        Connect a model
      </Button>
    </div>
  );
}
