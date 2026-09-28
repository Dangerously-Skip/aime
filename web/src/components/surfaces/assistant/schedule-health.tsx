"use client";

import { AlertCircle, AlertTriangle, PauseCircle } from "lucide-react";
import type { HealthItem } from "@/lib/schedule/health";

/**
 * "Needs attention" — the top of the Activity tab when a schedule is failing,
 * paused by errors, unreadable, or has missed a run. Renders nothing when all
 * is well, so it costs a healthy workspace no space at all.
 */
export function ScheduleHealth({
  items,
  onOpenOrder,
}: {
  items: HealthItem[];
  onOpenOrder: (orderId: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Schedules needing attention"
      className="mb-4 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
        <AlertCircle className="h-3.5 w-3.5" />
        Needs attention ({items.length})
      </h3>
      <ul className="space-y-1.5">
        {items.map((item) => {
          const Icon = item.kind === "paused" ? PauseCircle : item.kind === "overdue" ? AlertTriangle : AlertCircle;
          const tone = item.kind === "overdue" ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
          const body = (
            <>
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">{item.title}</span>
                <span className={`block text-[11px] ${tone}`}>{item.detail}</span>
              </span>
            </>
          );
          return (
            <li key={item.key}>
              {item.orderId ? (
                <button
                  type="button"
                  onClick={() => onOpenOrder(item.orderId!)}
                  className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-left hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/50"
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2 px-1 py-0.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
