"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWidgetStore } from "@/stores/widget-store";
import { useRunStore } from "@/stores/run-store";
import { parseWidget } from "@/lib/widgets/catalog";
import { WIDGET_ACTIONS, type WidgetActionName } from "@/lib/widgets/actions";
import type { Widget } from "@/lib/widgets/widget";
import type { Run } from "@/lib/runs/types";
import { formatRelative } from "@/lib/runs/format";
import { WidgetRenderer } from "./widget-renderer";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Trash2, Pause, Play } from "lucide-react";

/**
 * One Cockpit tile: the widget's last render, a refresh affordance, and its
 * schedule state. UX details ported from the Burnbox tile because they earned
 * their keep in real use:
 * - per-tile busy state with an ELAPSED counter, so a slow first generation
 *   reads as "working (12s)" rather than a frozen spinner;
 * - two-click destructive confirm (no window.confirm in an Electron webview);
 * - the stored node is re-validated through parseWidget on EVERY render — we
 *   don't trust our own stored bytes.
 */
export function WidgetTile({
  widget,
  onViewRuns,
}: {
  widget: Widget;
  onViewRuns?: (goalId: string) => void;
}) {
  const setRender = useWidgetStore((s) => s.setRender);
  const setEnabled = useWidgetStore((s) => s.setEnabled);
  const removeWidget = useWidgetStore((s) => s.removeWidget);

  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false); // two-click delete
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-validate stored bytes on every render.
  const node = useMemo(() => (widget.render ? parseWidget(widget.render) : null), [widget.render]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1_000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => () => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current);
  }, []);

  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/widgets/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widget }),
      });
      const data = await res.json();
      if (!res.ok || !data.node) {
        setError(typeof data.error === "string" ? data.error : "Refresh failed");
        return;
      }
      setRender(widget.id, data.node, Date.now());
      // Mirror the run into the live store so the Cockpit's run list updates
      // without a reload (the durable log already has it, server-side).
      if (data.run) {
        const run = data.run as Run;
        useRunStore.setState((s) => ({ runs: [run, ...s.runs.filter((r) => r.id !== run.id)] }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }, [busy, widget, setRender]);

  const onAction = useCallback(
    (action: WidgetActionName) => {
      if (action === WIDGET_ACTIONS.REFRESH) void refresh();
      else if (action === WIDGET_ACTIONS.VIEW_RUNS) onViewRuns?.(`widget:${widget.id}`);
      else if (action === WIDGET_ACTIONS.TOGGLE_ENABLED) setEnabled(widget.id, !widget.enabled);
      // deliverable.open has no meaning on a tile whose deliverable IS the tile.
    },
    [refresh, onViewRuns, setEnabled, widget.id, widget.enabled],
  );

  const handleDelete = () => {
    if (!armed) {
      setArmed(true);
      disarmTimer.current = setTimeout(() => setArmed(false), 3_000);
      return;
    }
    removeWidget(widget.id);
  };

  return (
    <div className="mb-4 inline-block w-full break-inside-avoid rounded-xl border border-border/60 bg-card align-top">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            widget.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
        />
        <p className="min-w-0 flex-1 truncate text-xs font-medium" title={widget.recipe}>
          {widget.title}
        </p>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {busy
            ? `working (${elapsed}s)`
            : widget.refreshedAt
              ? formatRelative(widget.refreshedAt, Date.now())
              : "never run"}
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          title="Refresh now"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          title={widget.enabled ? "Pause schedule" : "Resume schedule"}
          onClick={() => setEnabled(widget.id, !widget.enabled)}
        >
          {widget.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={`h-5 w-5 ${armed ? "text-red-600 dark:text-red-400" : ""}`}
          title={armed ? "Click again to delete" : "Delete widget"}
          onClick={handleDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="p-3">
        {error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
        {node ? (
          <WidgetRenderer node={node} onAction={onAction} />
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {busy ? "Generating… the first run can take a while." : "Not rendered yet — refresh to populate."}
          </p>
        )}
      </div>
    </div>
  );
}
