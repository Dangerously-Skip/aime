"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRunStore } from "@/stores/run-store";
import { useAssistantStore } from "@/stores/assistant-store";
import { standingOrdersToGoals } from "@/lib/runs/standing-order-goal";
import { summarizeRuns } from "@/lib/runs/runs";
import { outcomeLabel, isUnmet } from "@/lib/runs/verification";
import {
  byNewest,
  formatDuration,
  formatRelative,
  formatTokens,
  formatUntil,
  formatUsd,
  healthLine,
  nextRunAt,
  statusTone,
  type StatusTone,
} from "@/lib/runs/format";
import type { Goal, Run } from "@/lib/runs/types";
import { WidgetGrid } from "@/components/widgets/widget-grid";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

/**
 * Cockpit — scheduled work and what actually came of it.
 *
 * Reads the durable JSONL log via /api/runs rather than the client store, so it
 * shows runs that happened while the window was closed. The store is only
 * consulted for in-flight runs, which by definition exist only this session.
 */

const TONE_CLASS: Record<StatusTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  danger: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  neutral: "text-muted-foreground",
};

const TONE_DOT: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  danger: "bg-red-500",
  warn: "bg-amber-500",
  info: "bg-blue-500",
  neutral: "bg-muted-foreground/40",
};

function StatusIcon({ run }: { run: Run }) {
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
function RunStrip({ runs }: { runs: Run[] }) {
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

function RunRow({ run, now }: { run: Run; now: number }) {
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
  const liveRuns = useRunStore((s) => s.runs);
  const [logged, setLogged] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs?limit=500");
      const data = await res.json();
      setLogged(Array.isArray(data.runs) ? (data.runs as Run[]) : []);
    } catch {
      setLogged([]);
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep relative times honest without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /**
   * The durable log holds completed runs; the store holds in-flight ones. Merge
   * by id with the live copy winning, so a run that is still going shows as
   * running rather than being absent until it lands.
   */
  const allRuns = useMemo(() => {
    const byId = new Map<string, Run>();
    for (const r of logged) byId.set(r.id, r);
    for (const r of liveRuns) byId.set(r.id, r);
    return [...byId.values()];
  }, [logged, liveRuns]);

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

  const adHoc = useMemo(() => allRuns.filter((r) => !r.goalId).sort(byNewest), [allRuns]);
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

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent activity
            </h3>
            {adHoc.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
                {loading ? "Loading…" : "No runs recorded yet."}
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                {adHoc.slice(0, 50).map((r) => (
                  <RunRow key={r.id} run={r} now={now} />
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
