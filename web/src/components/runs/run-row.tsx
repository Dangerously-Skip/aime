"use client";

import { useState } from "react";
import type { Run } from "@/lib/runs/types";
import { outcomeLabel, isUnmet } from "@/lib/runs/verification";
import {
  byNewest,
  formatDuration,
  formatRelative,
  formatTokens,
  formatUsd,
  statusTone,
  type StatusTone,
} from "@/lib/runs/format";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Clock, ChevronRight, ChevronDown } from "lucide-react";

/**
 * One run, as a row — and the tone vocabulary the Cockpit shares with it.
 *
 * Lifted out of `cockpit.tsx` when the ad-hoc run log moved to the Activity
 * tab. Both tabs render runs and neither should own the other's components:
 * the Cockpit still shows a goal's OWN runs as evidence of its current health,
 * while the global log of one-off runs is a feed and belongs with the feed.
 */

export const TONE_CLASS: Record<StatusTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  danger: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  neutral: "text-muted-foreground",
};

export const TONE_DOT: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  danger: "bg-red-500",
  warn: "bg-amber-500",
  info: "bg-blue-500",
  neutral: "bg-muted-foreground/40",
};

export function StatusIcon({ run }: { run: Run }) {
  // A run that completed cleanly but missed its criteria must NOT get a tick —
  // that conflation is the whole thing verification exists to prevent.
  const tone = isUnmet(run) ? "warn" : statusTone(run.status);
  const cls = `h-3.5 w-3.5 shrink-0 ${TONE_CLASS[tone]}`;
  if (run.status === "running") return <Loader2 className={`${cls} animate-spin`} />;
  if (isUnmet(run)) return <AlertTriangle className={cls} />;
  if (run.status === "succeeded") return <CheckCircle2 className={cls} />;
  if (run.status === "failed") return <XCircle className={cls} />;
  if (run.status === "timeout" || run.status === "awaiting_approval")
    return <AlertTriangle className={cls} />;
  return <Clock className={cls} />;
}

/** A compact bar of recent outcomes — health at a glance, oldest → newest. */
export function RunStrip({ runs }: { runs: Run[] }) {
  const recent = [...runs].sort(byNewest).slice(0, 20).reverse();
  if (!recent.length) return null;
  return (
    <div className="flex items-end gap-[3px]" aria-label="Recent run outcomes">
      {recent.map((r) => (
        <span
          key={r.id}
          title={`${outcomeLabel(r)} · ${formatDuration(r.durationMs)} · ${formatUsd(r.cost?.totalUsd)}`}
          className={`w-1.5 rounded-sm ${
            TONE_DOT[isUnmet(r) ? "warn" : statusTone(r.status)]
          } ${r.status === "succeeded" && !isUnmet(r) ? "h-3" : "h-4"}`}
        />
      ))}
    </div>
  );
}

export function RunRow({ run, now }: { run: Run; now: number }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(run.error || run.deliverables.length || run.verification?.note);
  return (
    <div className="border-b border-border/40 last:border-0">
      <button
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs ${
          hasDetail ? "hover:bg-accent/40" : "cursor-default"
        }`}
      >
        {hasDetail ? (
          open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
               : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <StatusIcon run={run} />
        <span
          className={`w-24 shrink-0 font-medium ${
            TONE_CLASS[isUnmet(run) ? "warn" : statusTone(run.status)]
          }`}
        >
          {outcomeLabel(run)}
        </span>
        <span className="w-20 shrink-0 text-muted-foreground capitalize">{run.trigger}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={run.model}>
          {run.model ?? "—"}
        </span>
        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
          {formatDuration(run.durationMs)}
        </span>
        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
          {formatUsd(run.cost?.totalUsd)}
        </span>
        <span className="w-20 shrink-0 text-right text-muted-foreground">
          {formatRelative(run.startedAt, now)}
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-border/30 bg-muted/20 px-3 py-2 pl-11 text-xs">
          {run.error && <p className="text-red-600 dark:text-red-400">{run.error}</p>}
          {run.verification?.note && (
            <p className={isUnmet(run) ? TONE_CLASS.warn : "text-muted-foreground"}>
              {isUnmet(run) ? "Criteria not met: " : "Verified: "}
              {run.verification.note}
            </p>
          )}
          {run.cost && (
            <p className="text-muted-foreground tabular-nums">
              {formatTokens(run.cost.inputTokens)} in · {formatTokens(run.cost.outputTokens)} out
              {run.toolCalls != null && ` · ${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}`}
            </p>
          )}
          {run.deliverables.map((d, i) => (
            <p key={i} className="truncate text-muted-foreground">
              <span className="text-foreground">{d.title || d.kind}</span>
              {d.summary ? ` — ${d.summary}` : d.path ? ` — ${d.path}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
