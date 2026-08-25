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
import { Loader2, RefreshCw, Trash2, Pause, Play, MessageSquare, Bell, BellOff } from "lucide-react";
import { isUnread } from "@/lib/widgets/unread";
import { refreshByKind } from "@/lib/assistant/widget-presets";
import { resolveWidgetPresetConfig } from "@/lib/assistant/widget-config";
import { useAppStore } from "@/stores/app-store";
import { useChatStore } from "@/stores/chat-store";
import { useConversationStore } from "@/stores/conversation-store";
import { widgetConversationSeed } from "@/lib/widgets/widget-to-text";

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
/**
 * Widgets that have already had their one automatic first render this session.
 *
 * Module scope deliberately: it must outlive the tile's mount, which is exactly
 * what it is guarding against.
 */
const autoRendered = new Set<string>();

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
  const markSeen = useWidgetStore((s) => s.markSeen);
  // Where the user is / what they follow. Defaults derive from their time zone.
  const presetConfig = useMemo(() => resolveWidgetPresetConfig(null), []);
  const updateWidget = useWidgetStore((s) => s.updateWidget);
  const addConversation = useConversationStore((s) => s.addConversation);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const addMessage = useChatStore((s) => s.addMessage);
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);

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
    /*
     * DETERMINISTIC FIRST. A widget with a `refreshKind` has a built-in fetcher:
     * a stock price should never cost a model call, and the fetch is faster and
     * more reliable than asking an agent to go and look.
     *
     * This is the axis that used to be decided by authorship — shipped things
     * got fetchers, user things got agents — and is now a property of the
     * widget, so a built-in can be edited and a custom one could have a fetcher.
     */
    if (widget.refreshKind) {
      setBusy(true);
      try {
        const node = await refreshByKind(widget.refreshKind, presetConfig);
        if (node) setRender(widget.id, node, Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

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

  /*
   * A BRAND-NEW WIDGET RENDERS ITSELF, ONCE.
   *
   * Without this, creating one lands you on a tile reading "Not rendered yet —
   * refresh to populate", and waiting up to two minutes for the server tick to
   * pick it up. Both are honest and both read as broken: the user asked for a
   * weather widget and got a box saying there is no weather.
   *
   * ONCE PER SESSION PER WIDGET, tracked outside React. `!widget.render` alone
   * would re-fire on every remount — and the Assistant surface stays mounted and
   * remounts its tiles on tab changes — so a widget whose recipe genuinely fails
   * would spend a model call each time the user looked at it. The Set means one
   * attempt; after that the error and the refresh button are the user's move.
   */
  useEffect(() => {
    if (widget.render || autoRendered.has(widget.id)) return;
    autoRendered.add(widget.id);
    void refresh();
  }, [widget.render, widget.id, refresh]);

  const onAction = useCallback(
    (action: WidgetActionName) => {
      if (action === WIDGET_ACTIONS.REFRESH) void refresh();
      else if (action === WIDGET_ACTIONS.VIEW_RUNS) onViewRuns?.(`widget:${widget.id}`);
      else if (action === WIDGET_ACTIONS.TOGGLE_ENABLED) setEnabled(widget.id, !widget.enabled);
      // deliverable.open has no meaning on a tile whose deliverable IS the tile.
    },
    [refresh, onViewRuns, setEnabled, widget.id, widget.enabled],
  );

  /**
   * Open a chat about this tile.
   *
   * THE ONE THING A CARD CANNOT DO. A widget is glanceable and mute — you can
   * see that three cameras are underpriced and you cannot ask which to bid on.
   * That is what a heartbeat could do and a schedule cannot, and this is how the
   * widget model gets it back without a second proactive mechanism competing
   * with the first.
   *
   * The card's CONTENT and its RECIPE both travel, because the likeliest next
   * question is "why is that one cheap?" — and an agent without the recipe
   * invents a provenance, which is an uncited claim one layer up.
   */
  const handleDiscuss = () => {
    const chatId = crypto.randomUUID();
    addConversation({
      id: chatId,
      title: widget.title,
      surface: "chat",
      lastMessage: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    addMessage(chatId, {
      id: crypto.randomUUID(),
      // ASSISTANT, not user: the tile is something the agent produced, and
      // seeding it as the user's own words would have them apparently say
      // something they never typed.
      role: "assistant",
      content: widgetConversationSeed(widget, node, Date.now()),
      timestamp: Date.now(),
    });
    setActiveConversation(chatId);
    setActiveSurface("chat");
  };

  const handleDelete = () => {
    if (!armed) {
      setArmed(true);
      disarmTimer.current = setTimeout(() => setArmed(false), 3_000);
      return;
    }
    removeWidget(widget.id);
  };

  /*
   * The tile is "read" once it has been on screen for a moment.
   *
   * A moment, not instantly: widgets render in a masonry grid and several are
   * mounted at once, so marking on mount would clear every badge the instant the
   * surface opened — including tiles below the fold that were never looked at.
   * A short dwell is the cheapest approximation of "looked at" that does not
   * need an intersection observer, and erring towards leaving it unread is the
   * right direction: a badge that lingers is a nuisance, one that vanishes loses
   * the news.
   */
  const unread = isUnread(widget);
  useEffect(() => {
    if (!unread) return;
    const t = setTimeout(() => markSeen(widget.id), 2_000);
    return () => clearTimeout(t);
  }, [unread, widget.id, widget.refreshedAt, markSeen]);

  return (
    <div
      className={`mb-4 inline-block w-full break-inside-avoid rounded-xl border bg-card align-top ${
        unread ? "border-primary/50" : "border-border/60"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
            widget.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
        />
        <p className="min-w-0 flex-1 truncate text-xs font-medium" title={widget.recipe}>
          {widget.title}
        </p>
        {unread && (
          <span
            className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground"
            aria-label="New since you last looked"
          >
            new
          </span>
        )}
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
          title={widget.notifyOnChange ? "Notifications on — click to mute" : "Notify me when this changes"}
          aria-label={widget.notifyOnChange ? "Mute notifications" : "Notify me when this changes"}
          onClick={() => updateWidget(widget.id, { notifyOnChange: !widget.notifyOnChange })}
        >
          {widget.notifyOnChange ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3 opacity-40" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5"
          title="Ask about this"
          aria-label="Ask about this"
          onClick={handleDiscuss}
        >
          <MessageSquare className="h-3 w-3" />
        </Button>
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
