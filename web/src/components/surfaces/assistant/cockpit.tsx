"use client";

import { useMemo, useState } from "react";
import { useRunStore } from "@/stores/run-store";
import { useAssistantStore } from "@/stores/assistant-store";
import { standingOrdersToGoals } from "@/lib/runs/standing-order-goal";
import { summarizeRuns } from "@/lib/runs/runs";
import {
  byNewest,
  formatDuration,
  formatUntil,
  formatUsd,
  healthLine,
  nextRunAt } from "@/lib/runs/format";
import type { Goal, Run } from "@/lib/runs/types";
import { WidgetGrid } from "@/components/widgets/widget-grid";
import { RunRow, RunStrip, TONE_CLASS } from "@/components/runs/run-row";
import { useRunLog } from "@/components/runs/use-run-log";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  Loader2,
  RefreshCw,
  } from "lucide-react";

/**
 * Cockpit — scheduled work and what actually came of it.
 *
 * Reads runs through `useRunLog` — the durable JSONL log rather than the client
 * store, so it
 * shows runs that happened while the window was closed. The store is only
 * consulted for in-flight runs, which by definition exist only this session.
 */

function GoalCard({ goal, runs, now }: { goal: Goal; runs: Run[]; now: number }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeRuns(runs), [runs]);
  const next = nextRunAt(goal, now);

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
            !goal.enabled ? "bg-muted-foreground/40"
              : summary.currentlyFailing ? "bg-red-500"
              : "bg-emerald-500"
          }`}
          title={goal.enabled ? "Enabled" : "Paused"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={goal.objective}>
            {goal.objective}
          </p>
          <p
            className={`text-xs ${
              summary.currentlyFailing ? TONE_CLASS.danger : "text-muted-foreground"
            }`}
          >
            {healthLine(summary, now)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">
            {goal.schedule?.cron
              ? goal.schedule.cron
              : next != null
                ? formatUntil(next, now)
                : "Manual"}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">{formatUsd(summary.totalUsd)} total</p>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 pb-3">
        <RunStrip runs={runs} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {summary.total} run{summary.total === 1 ? "" : "s"}
          {summary.medianDurationMs != null && ` · ~${formatDuration(summary.medianDurationMs)}`}
          {/* History from before run tracking existed. Shown as context so a
              long-standing order doesn't read as "never run", but kept out of
              the success rate — we know it ran, not what happened. */}
          {summary.total === 0 && goal.prior && (
            <> · {goal.prior.runCount} before tracking</>
          )}
        </span>
        {runs.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 text-xs"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide runs" : "View runs"}
          </Button>
        )}
      </div>

      {open && (
        <div className="border-t border-border/50">
          {[...runs].sort(byNewest).map((r) => (
            <RunRow key={r.id} run={r} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Cockpit() {
  const ownGoals = useRunStore((s) => s.goals);
  // Standing orders ARE goals — a durable instruction with a schedule, a
  // completion condition and a run history. Adapting them means the Cockpit
  // reflects what the user has already set up instead of asking them to
  // recreate it. Adapted on read (not copied into the store) so the order
  // remains the single source of truth and cannot drift.
  const orders = useAssistantStore((s) => s.orders);
  const goals = useMemo(
    () => [...standingOrdersToGoals(orders), ...ownGoals],
    [orders, ownGoals],
  );
  // Shared with the Activity tab's run log — see `useRunLog`.
  const { runs: allRuns, now, loading, reload: load } = useRunLog();

  const runsByGoal = useMemo(() => {
    const map = new Map<string, Run[]>();
    for (const r of allRuns) {
      if (!r.goalId) continue;
      const list = map.get(r.goalId) ?? [];
      list.push(r);
      map.set(r.goalId, list);
    }
    return map;
  }, [allRuns]);

  const overall = useMemo(() => summarizeRuns(allRuns), [allRuns]);
  const active = allRuns.filter((r) => r.status === "running").length;
  const failingGoals = goals.filter(
    (g) => summarizeRuns(runsByGoal.get(g.id) ?? []).currentlyFailing,
  ).length;

  return (
    /*
     * `min-h-0` on BOTH, and neither is cosmetic.
     *
     * A flex item defaults to `min-height: auto`, meaning it refuses to shrink
     * below its content. So the ScrollArea below grew to the full height of
     * every widget, the Cockpit overflowed the window, and the tiles past the
     * fold were simply clipped — with no scrollbar, because the thing that was
     * meant to scroll had been sized to fit instead.
     *
     * Reported as "I can't scroll widgets". A ScrollArea only scrolls when
     * something upstream tells it how tall it is allowed to be.
     */
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-5 py-3">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Cockpit</h2>
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
          {active > 0 && (
            <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {active} running
            </span>
          )}
          {failingGoals > 0 && (
            <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              {failingGoals} failing
            </span>
          )}
          <span>{overall.total} runs</span>
          {/* The number none of OpenClaw, openworker or Burnbox can show you. */}
          <span title="Total spend across all recorded runs">{formatUsd(overall.totalUsd)} spent</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={load} title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-5">
          <WidgetGrid />

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Scheduled work
            </h3>
            {goals.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
                No goals yet. Standing orders and scheduled widgets will appear here with their run
                history and cost.
              </p>
            ) : (
              <div className="space-y-2.5">
                {goals.map((g) => (
                  <GoalCard key={g.id} goal={g} runs={runsByGoal.get(g.id) ?? []} now={now} />
                ))}
              </div>
            )}
          </section>

        </div>
      </ScrollArea>
    </div>
  );
}
