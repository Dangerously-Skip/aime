"use client";

import { useMemo } from "react";
import { byNewest } from "@/lib/runs/format";
import type { Run } from "@/lib/runs/types";
import { RunRow } from "./run-row";

/**
 * One-off runs, newest first — the Activity tab's record of what happened.
 *
 * WHY IT IS NOT ON THE COCKPIT. It was, under the heading "Recent activity",
 * directly beneath the widgets, on a tab sitting next to one called Activity.
 * Asked as "cockpit panel is showing both the widgets and the activity…
 * shouldn't activity be on the activity tab?" — and the rule this codebase
 * already applies settles it the same way:
 *
 *     Activity is EVENTS. The Cockpit is STATE.
 *
 * A finished run is an event. It has a start time and it never changes again,
 * which is the definition of something that belongs in a feed rather than on a
 * dashboard. That is the same rule that moved the widget quick-add buttons the
 * other way last week, and applying it in only one direction is how the two
 * tabs came to read as the same screen.
 *
 * WHAT STAYS ON THE COCKPIT: a goal's OWN runs, inside its card. Those are not
 * a feed — they are the evidence for a claim the dashboard is making right now
 * ("this goal is failing"), and a streak you cannot see the runs behind is an
 * uncited claim.
 *
 * So the split is by OWNERSHIP, not by type: runs belonging to a goal are that
 * goal's health, runs belonging to nothing are history.
 */
export function RunLog({
  runs,
  now,
  loading,
  limit = 50,
}: {
  runs: Run[];
  now: number;
  loading?: boolean;
  limit?: number;
}) {
  // Runs with no goal: chats and manual runs. A goal's runs live in its card.
  const adHoc = useMemo(() => runs.filter((r) => !r.goalId).sort(byNewest), [runs]);

  return (
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
          {adHoc.slice(0, limit).map((r) => (
            <RunRow key={r.id} run={r} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}
