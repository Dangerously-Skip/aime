"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useAssistantStore, type StandingOrder, type AssistantCard } from "@/stores/assistant-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useHydrated } from "@/components/store-hydration";
import { useStandingOrders } from "@/hooks/use-standing-orders";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { A2UIDocumentRenderer } from "@/lib/a2ui/renderer";
import type { A2UIAction } from "@/lib/a2ui/types";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import { Composer } from "@/components/shared/composer/composer";
import { setComposerText } from "@/components/shared/composer/draft-store";
import type { AttachmentFile } from "@/components/shared/attachment-menu";
import { NoModelCard } from "@/components/shared/no-model-card";
import { TurnErrorBanner } from "@/components/shared/turn-error-banner";
import {
  RefreshCw,
  Square,
  Play,
  Pause,
  Trash2,
  X,
  Clock,
  Zap,
  CheckCircle2,
  AlertCircle,
  Download,
  PanelLeftClose,
  PanelLeft,
  Bot,
  Sun,
  Moon,
  Timer,
  Hammer,
  BookOpen,
  GitPullRequest,
  type LucideIcon,
} from "lucide-react";

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  sun: Sun, moon: Moon, timer: Timer, hammer: Hammer,
  'book-open': BookOpen, 'git-pull-request': GitPullRequest,
};

import { STANDING_ORDER_TEMPLATES, type StandingOrderTemplate } from "@/lib/standing-order-templates";
import { TemplateDialog } from "./template-dialog";
import { OrderEditor, confirmDeleteOrder } from "./order-editor";
import { ScheduleHealth } from "./schedule-health";
import { scheduleHealth } from "@/lib/schedule/health";
import { useAttendedJobs } from "@/hooks/use-attended-jobs";
import { APP_NAME } from "@/config/branding";
import { describeTrigger, validateTrigger } from "@/lib/schedule/schedule";
import { exportOrdersToJson } from "@/lib/standing-order-yaml";
import { Cockpit } from "./cockpit";
import { RunLog } from "@/components/runs/run-log";
import { useRunLog } from "@/components/runs/use-run-log";
import { useWidgetRefresh } from "@/hooks/use-widget-refresh";
import { handleAgnosticChunk } from "@/lib/sse/agnostic-chunks";
import { classifyTurnError, isTurnErrorCode } from "@/lib/sse/turn-error";
import { streamRegistry } from "@/lib/stream-registry";
import { useScheduledPrompt } from "@/hooks/use-scheduled-prompt";
import { useSSEStream, turnErrorOf } from "@/hooks/use-sse-stream";
import { useTurnWiring } from "@/hooks/use-turn-wiring";
import { useModelReady } from "@/hooks/use-model-ready";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useProviderStore } from "@/stores/provider-store";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";
import { summarizeRuns } from "@/lib/runs/runs";
import type { Run, RunTrigger } from "@/lib/runs/types";

// ── Orders Sidebar ───────────────────────────────────────────────────────────

function OrdersSidebar({
  orders,
  onSelectOrder,
  selectedOrderId,
  collapsed,
  onToggleCollapsed,
  onActivateTemplate,
}: {
  orders: StandingOrder[];
  onSelectOrder: (id: string | null) => void;
  selectedOrderId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onActivateTemplate: (tpl: StandingOrderTemplate) => void;
}) {
  const pauseOrder = useAssistantStore((s) => s.pauseOrder);
  const resumeOrder = useAssistantStore((s) => s.resumeOrder);
  const resumeAllPaused = useAssistantStore((s) => s.resumeAllPaused);
  const removeOrder = useAssistantStore((s) => s.removeOrder);

  const activeOrders = orders.filter((o) => o.status === 'active');
  const pausedOrders = orders.filter((o) => o.status === 'paused');
  const completedOrders = orders.filter((o) => o.status === 'completed' || o.status === 'expired');

  const statusIcon = (status: StandingOrder['status']) => {
    switch (status) {
      case 'active': return <Zap className="h-3 w-3 text-green-500" />;
      case 'paused': return <Pause className="h-3 w-3 text-yellow-500" />;
      case 'completed': return <CheckCircle2 className="h-3 w-3 text-muted-foreground" />;
      case 'expired': return <AlertCircle className="h-3 w-3 text-muted-foreground" />;
    }
  };

  // In words, from the same module the tickers use — never raw cron.
  const triggerLabel = (order: StandingOrder) => describeTrigger(order.trigger);

  if (collapsed) {
    return (
      <div className="w-12 p-2 flex flex-col items-center">
        <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} title="Expand sidebar" aria-label="Expand sidebar">
          <PanelLeft className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const renderOrderGroup = (label: string, items: StandingOrder[]) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1">{label}</div>
        {items.map((order) => (
          /*
           * A DIV WITH A BUTTON ROLE, not a <button>.
           *
           * The row carries its own Pause/Resume/Delete buttons, and HTML
           * forbids a button inside a button — React reported it twice as a
           * hydration error ("In HTML, <button> cannot be a descendant of
           * <button>"), and the browser's own parser recovers by hoisting the
           * inner ones OUT of the row, which is why they still worked.
           *
           * Keyboard behaviour is kept by hand because a div does not get it
           * free: Enter and Space activate, and it is a tab stop.
           */
          <div
            key={order.id}
            role="button"
            tabIndex={0}
            aria-pressed={selectedOrderId === order.id}
            className={`w-full cursor-pointer text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-start gap-2 group ${
              selectedOrderId === order.id ? 'bg-muted' : ''
            }`}
            onClick={() => onSelectOrder(selectedOrderId === order.id ? null : order.id)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              // Not when the key came from one of the nested controls.
              if ((e.target as HTMLElement) !== e.currentTarget) return;
              e.preventDefault();
              onSelectOrder(selectedOrderId === order.id ? null : order.id);
            }}
          >
            {statusIcon(order.status)}
            <div className="flex-1 min-w-0">
              <div className="truncate text-xs" title={order.instruction}>{order.instruction}</div>
              <div
                className={`text-xs truncate ${validateTrigger(order.trigger) ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                title={order.trigger.expression ?? order.trigger.event}
              >
                {triggerLabel(order)}
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              {order.status === 'active' && (
                <button
                  onClick={(e) => { e.stopPropagation(); pauseOrder(order.id); }}
                  title="Pause"
                  aria-label="Pause schedule"
                >
                  <Pause className="h-3 w-3 text-muted-foreground hover:text-yellow-500" />
                </button>
              )}
              {order.status === 'paused' && (
                <button
                  onClick={(e) => { e.stopPropagation(); resumeOrder(order.id); }}
                  title="Resume"
                  aria-label="Resume schedule"
                >
                  <Play className="h-3 w-3 text-muted-foreground hover:text-green-500" />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmDeleteOrder(order)) removeOrder(order.id);
                }}
                title="Delete"
                aria-label="Delete schedule"
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="w-[220px] p-2 flex flex-col shrink-0">
      <div className="surface-well flex flex-1 min-h-0 flex-col">
      <div className="flex items-center justify-between gap-1 px-3 py-2">
        <span className="min-w-0 truncate whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schedules</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost" size="icon-sm"
            onClick={() => exportOrdersToJson(orders)}
            title="Export schedules"
            aria-label="Export schedules"
            disabled={orders.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} title="Collapse sidebar" aria-label="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-2">
          {orders.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              <Clock className="h-5 w-5 mx-auto mb-1.5 opacity-40" />
              No schedules yet
            </div>
          ) : (
            <>
              {renderOrderGroup('Active', activeOrders)}
              {pausedOrders.length > 1 && (
                <div className="px-3 mb-1">
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => resumeAllPaused()}
                  >
                    Resume all ({pausedOrders.length})
                  </button>
                </div>
              )}
              {renderOrderGroup('Paused', pausedOrders)}
              {renderOrderGroup('Completed', completedOrders)}
            </>
          )}

          {/* Templates */}
          <div className="mt-4 pt-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-3 mb-1">Quick Start</div>
            {STANDING_ORDER_TEMPLATES.slice(0, 4).map((tpl) => (
              <button
                key={tpl.id}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2"
                onClick={() => onActivateTemplate(tpl)}
              >
                {(() => { const Icon = TEMPLATE_ICONS[tpl.icon]; return Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : null; })()}
                <div className="min-w-0">
                  <div className="truncate font-medium">{tpl.label}</div>
                  <div className="text-muted-foreground truncate">{tpl.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </ScrollArea>
      </div>
    </div>
  );
}

// ── Single Card Widget ───────────────────────────────────────────────────────

/**
 * Does this card end by asking the user something?
 *
 * Only a sentence that ENDS in "?" counts. The old test also matched
 * `what|when|how|which` ANYWHERE, unbounded — so "somewhat", "however",
 * "showing" and "whenever" all put a Reply button on the card, which was nearly
 * every card. A question word alone is not a question either: "Here is how to
 * fix it." asks nothing.
 */
export function cardAsksQuestion(summary?: string): boolean {
  if (!summary) return false;
  // The last sentence, ignoring trailing markdown emphasis and whitespace.
  const text = summary.trim().replace(/[*_`\s]+$/, '');
  if (!text.endsWith('?')) return false;
  const last = text.split(/(?<=[.!?])\s+/).pop() ?? '';
  return /\?$/.test(last);
}

/** A time for today's cards; a date too for anything older, so "09:12" is never ambiguous. */
export function formatCardTime(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${date}, ${time}`;
}

/**
 * What a reply to a card sends: the card itself as context, then the reply.
 *
 * A reply starts a fresh turn, and it used to carry only the card's TITLE — so
 * answering "Which of these three should I book?" sent the model the question's
 * heading and none of the three options.
 */
export function buildCardReply(card: Pick<AssistantCard, 'title' | 'summary'> | undefined, text: string): string {
  if (!card) return text;
  const body = (card.summary ?? '').trim();
  const excerpt = body.length > 2000 ? `${body.slice(0, 2000)}…` : body;
  const quoted = excerpt ? `\n${excerpt.split('\n').map((l) => `> ${l}`).join('\n')}\n` : '';
  return `Replying to your earlier message "${card.title}":${quoted}\n${text}`;
}

function CardWidget({
  card,
  onAction,
  onReply,
  expanded,
  onToggleExpand,
  streaming = false,
  onStop,
  onRetry,
}: {
  card: AssistantCard;
  onAction?: (action: A2UIAction) => void;
  onReply: (cardId: string, text: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  /** This card's turn is running — it gets its own Stop. */
  streaming?: boolean;
  onStop?: (cardId: string) => void;
  /** Run the card's prompt again, into this card. */
  onRetry?: (cardId: string) => void;
}) {
  const dismissCard = useAssistantStore((s) => s.dismissCard);
  const pinCard = useAssistantStore((s) => s.pinCard);
  const unpinCard = useAssistantStore((s) => s.unpinCard);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const hasA2UIDoc = !!card.doc;
  const isLong = (card.summary?.length || 0) > 300;
  const hasQuestion = cardAsksQuestion(card.summary);

  return (
    <div
      className={`group rounded-xl border bg-card shadow-sm hover:shadow-md transition-all overflow-hidden ${
        card.tone === 'error' ? 'border-red-500/40' : 'border-border/50'
      }`}
      data-tone={card.tone}
    >
      {/* Header — clean, no colored strips */}
      <div className="flex items-start justify-between px-5 pt-4 pb-1">
        <div className="flex-1 min-w-0 pr-2">
          <p className="text-sm font-semibold text-foreground leading-snug flex items-center gap-1.5">
            {card.tone === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Failed" />}
            {card.title}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            {formatCardTime(card.timestamp)}
            {card.pinned && ' · Pinned'}
            {card.unread && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary ml-1.5 align-middle" />}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => dismissCard(card.id)} className="shrink-0 -mt-1 -mr-2 opacity-0 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100" title="Dismiss" aria-label="Dismiss card">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Body — collapsible */}
      <div className={`${!expanded && isLong ? 'max-h-[180px] overflow-hidden relative' : ''}`}>
        {hasA2UIDoc ? (
          <A2UIDocumentRenderer doc={card.doc!} onAction={onAction} />
        ) : card.summary ? (
          <div className="px-5 pb-3">
            <MarkdownRenderer content={card.summary} className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
          </div>
        ) : null}
        {!expanded && isLong && (
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-card to-transparent" />
        )}
      </div>

      {card.retrying && streaming && (
        <div className="flex items-center gap-1.5 px-5 pb-2 text-xs text-muted-foreground" role="status">
          <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
          Retrying (attempt {card.retrying.attempt})…
        </div>
      )}

      {/* A failed turn, as on every other surface — not text in the card. */}
      {card.error && (
        <div className="px-5 pb-3">
          <TurnErrorBanner
            code={card.error.code}
            message={card.error.message}
            onRetry={card.prompt && onRetry && !streaming ? () => onRetry(card.id) : undefined}
          />
        </div>
      )}

      {streaming && onStop && (
        <div className="px-5 pb-2">
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => onStop(card.id)} aria-label="Stop this reply">
            <Square className="h-3 w-3" aria-hidden="true" />
            Stop
          </Button>
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between px-5 pb-3 pt-1">
        <div className="flex gap-1.5">
          {hasQuestion && (
            <button
              onClick={() => setReplyOpen(!replyOpen)}
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Reply
            </button>
          )}
          {isLong && (
            <button
              onClick={onToggleExpand}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => card.pinned ? unpinCard(card.id) : pinCard(card.id)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            title={card.pinned ? "Unpin" : "Pin"}
          >
            {card.pinned ? 'Unpin' : 'Pin'}
          </button>
          <span className="text-muted-foreground/30">·</span>
          <button
            onClick={() => dismissCard(card.id)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>

      {/* Inline reply */}
      {replyOpen && (
        <div className="px-5 py-3 border-t border-border/30 bg-muted/10">
          <div className="flex gap-2">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && replyText.trim()) {
                  onReply(card.id, replyText.trim());
                  setReplyText('');
                  setReplyOpen(false);
                }
              }}
              placeholder="Type a reply..."
              aria-label="Reply"
              className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              autoFocus
            />
            <Button
              size="sm"
              onClick={() => {
                if (replyText.trim()) {
                  onReply(card.id, replyText.trim());
                  setReplyText('');
                  setReplyOpen(false);
                }
              }}
              disabled={!replyText.trim()}
              aria-label="Send reply"
            >
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card Feed (Bento Layout) ─────────────────────────────────────────────────

function CardFeed({
  cards,
  onAction,
  onReply,
  streaming,
  onStop,
  onRetry,
}: {
  cards: AssistantCard[];
  onAction?: (action: A2UIAction) => void;
  onReply: (cardId: string, text: string) => void;
  /** Cards whose turn is running. */
  streaming?: ReadonlySet<string>;
  onStop?: (cardId: string) => void;
  onRetry?: (cardId: string) => void;
}) {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const pinnedCards = cards.filter((c) => c.pinned);
  const unpinnedCards = cards.filter((c) => !c.pinned);
  const sortedCards = [...pinnedCards, ...unpinnedCards];

  if (sortedCards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <Bot className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No cards yet</p>
        <p className="text-xs mt-1">Standing order results will appear here</p>
      </div>
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Split into two columns for bento layout
  const col1: AssistantCard[] = [];
  const col2: AssistantCard[] = [];
  sortedCards.forEach((card, i) => {
    if (i % 2 === 0) col1.push(card); else col2.push(card);
  });

  const renderCard = (card: AssistantCard) => (
    <CardWidget
      key={card.id}
      card={card}
      onAction={onAction}
      onReply={onReply}
      expanded={expandedCards.has(card.id)}
      onToggleExpand={() => toggleExpand(card.id)}
      streaming={streaming?.has(card.id)}
      onStop={onStop}
      onRetry={onRetry}
    />
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="space-y-3">{col1.map(renderCard)}</div>
      <div className="space-y-3">{col2.map(renderCard)}</div>
    </div>
  );
}

// ── Status Bar ───────────────────────────────────────────────────────────────

/**
 * The footer's numbers come from the SAME run log the rows above it render.
 *
 * It used to sum `order.runCount` — standing-order executions only — under the
 * label "total runs", directly beneath a Recent Activity list of chat turns. So
 * the list showed a run and the footer said "0 total runs", and neither was
 * wrong about what it counted; they just were not counting the same thing.
 */
export function StatusBar({ orders, runs }: { orders: StandingOrder[]; runs: Run[] }) {
  const activeCount = orders.filter((o) => o.status === 'active').length;
  const unreadCount = useAssistantStore((s) => s.cards.filter((c) => c.unread).length);
  const summary = summarizeRuns(runs);

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border text-xs text-muted-foreground">
      <span>{activeCount} active schedule{activeCount !== 1 ? 's' : ''}</span>
      {unreadCount > 0 && <span className="text-primary">{unreadCount} unread</span>}
      <span>{summary.total} run{summary.total !== 1 ? 's' : ''} recorded</span>
      {summary.failed > 0 && (
        <span className="text-red-600 dark:text-red-400">{summary.failed} failed</span>
      )}
    </div>
  );
}

// ── Main Surface ─────────────────────────────────────────────────────────────

const CAPABILITY = getSurfaceRoute("assistant").capability;

export function AssistantSurface() {
  const hydrated = useHydrated();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Assistant feed vs. Cockpit (scheduled work + run outcomes). */
  const [view, setView] = useState<"feed" | "cockpit">("feed");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<StandingOrderTemplate | null>(null);

  const orders = useAssistantStore((s) => s.orders);
  const cards = useAssistantStore((s) => s.cards);
  const addCard = useAssistantStore((s) => s.addCard);
  const updateCard = useAssistantStore((s) => s.updateCard);

  // The route comes from the SAME `resolveSendRoute` chokepoint every other
  // surface uses — see `runCard`.
  const providers = useProviderStore((s) => s.providers);
  const tierModels = useSettingsStore((s) => s.tierModels);
  const { hasAnthropicKey, hasBedrock, known: builtinAccessKnown } = useBuiltinAccess();

  // Hydrate store on mount
  useEffect(() => {
    if (hydrated) {
      useAssistantStore.persist.rehydrate();
    }
  }, [hydrated]);

  // Standing order trigger engine
  useStandingOrders();
  useWidgetRefresh();

  /*
   * The same runs the Cockpit reads, from the same hook. Two fetches of the
   * same log would drift the moment one of them refreshed and the other did
   * not — and a cost total that disagrees with the rows under it is worse than
   * either number alone.
   */
  const { runs, now: runsNow, loading: runsLoading } = useRunLog();

  /*
   * HEALTH, on the tab people actually look at. Failing, error-paused,
   * unreadable and overdue schedules — standing orders and attended jobs alike —
   * lead the Activity tab, so noticing a broken automation does not depend on
   * remembering to open the Cockpit.
   */
  const activityLog = useAssistantStore((s) => s.activity);
  const { jobs: attendedJobs } = useAttendedJobs();
  const health = useMemo(
    () =>
      scheduleHealth({
        orders: [
          ...orders,
          ...attendedJobs.map((j) => ({
            id: j.id,
            instruction: j.prompt,
            trigger: j.trigger,
            status: j.status,
            lastRun: j.lastRun,
            createdAt: j.createdAt,
            runCount: j.runCount,
            maxExecutions: j.maxExecutions,
            expiresAt: j.expiresAt,
            attended: true,
          })),
        ],
        activity: activityLog,
        runs,
        now: runsNow,
        appName: APP_NAME,
      }),
    [orders, attendedJobs, activityLog, runs, runsNow],
  );

  // A selection whose order was deleted is no selection.
  const openOrderId = selectedOrderId && orders.some((o) => o.id === selectedOrderId) ? selectedOrderId : null;

  // One-time migration of existing cron jobs to standing orders
  useEffect(() => {
    if (!hydrated) return;
    const migrationKey = 'aime:cron-migrated';
    const legacyMigrationKey = 'nibcowork:cron-migrated';
    if (
      typeof localStorage !== 'undefined' &&
      !localStorage.getItem(migrationKey) &&
      !localStorage.getItem(legacyMigrationKey)
    ) {
      try {
        // Check the current key first, then the pre-rename legacy key
        const cronRaw = localStorage.getItem('aime:cron') ?? localStorage.getItem('nibcowork:cron');
        if (cronRaw) {
          const cronData = JSON.parse(cronRaw);
          const jobs = cronData?.state?.jobs;
          if (Array.isArray(jobs) && jobs.length > 0) {
            useAssistantStore.getState().migrateCronJobs(jobs);
            console.log('[Assistant] Migrated', jobs.length, 'cron jobs to standing orders');
          }
        }
        localStorage.setItem(migrationKey, '1');
      } catch (e) {
        console.error('[Assistant] Cron migration error:', e);
      }
    }
  }, [hydrated]);

  /*
   * EVERY CARD IS ITS OWN TURN.
   *
   * This surface streamed through a reader of its own with one surface-wide
   * `isStreaming`: a scheduled run locked the composer, Stop stopped whichever
   * turn was running, and a failure was written into the card's text. It now
   * rides the same stream hook as every other surface, one chat id per card
   * turn, so cards stream side by side, each has its own Stop, and a failure is
   * the same typed banner — with Try again — that a chat reply gets.
   */
  const cardByChat = useRef(new Map<string, string>());
  const chatByCard = useRef(new Map<string, string>());
  /** A card turn's text so far, so a Stop can keep it. */
  const textByChat = useRef(new Map<string, string>());
  /** Cards whose turn is running, by card id. */
  const [streaming, setStreaming] = useState<Record<string, true>>({});
  /** The card the composer started last — the one its Stop and Esc stop. */
  const [composerCard, setComposerCard] = useState("");
  const isStreaming = !!composerCard && !!streaming[composerCard];
  const streamingCards = useMemo(() => new Set(Object.keys(streaming)), [streaming]);

  const ownsChat = useCallback((id: string) => cardByChat.current.has(id), []);
  // Run records, the abort listener and reported failures — as every surface has.
  const { runRecorder } = useTurnWiring({ surfaceId: "assistant", chatId: "", ownsChat });

  const setChatStreaming = useCallback((chatId: string, on: boolean) => {
    const cardId = cardByChat.current.get(chatId);
    if (!cardId) return;
    setStreaming((s) => {
      if (!!s[cardId] === on) return s;
      const next = { ...s };
      if (on) next[cardId] = true;
      else delete next[cardId];
      return next;
    });
  }, []);

  const { sendMessage } = useSSEStream({
    // Stop goes through `stopCard`, per card, not this hook's `abort`.
    chatId: "",
    setIsStreaming: () => {},
    setChatStreaming,
    coalesceText: true,
    onUsage: runRecorder.onUsage,
    onChunk(event, cid) {
      if (handleAgnosticChunk(event, {
        chatId: cid,
        surface: 'Assistant',
        /*
         * Card AND desktop notification by default. 'assistant' (card only)
         * meant "remind me to stretch" never popped up — a reminder that lands
         * silently in a feed you are not looking at is not a reminder.
         */
        notifyVia: 'toast',
      })) return;
      const cardId = cardByChat.current.get(cid);
      if (!cardId) return;
      if (event.type === 'text' && typeof event.content === 'string') {
        const text = (textByChat.current.get(cid) ?? '') + event.content;
        textByChat.current.set(cid, text);
        // Output arriving means the retry it was waiting on succeeded.
        updateCard(cardId, { summary: text, retrying: undefined });
      } else if (event.type === 'error') {
        /*
         * Every server-side failure arrives here — watchdog kills, silence
         * timeouts, model/auth errors. Dropped, they left the card saying
         * "Thinking..." for ever on exactly the surface whose work runs
         * unattended. Kept apart from the summary, so the text that did
         * arrive stays and a late chunk cannot overwrite the error away.
         */
        const message = (event.message as string) || 'The turn failed.';
        const code = isTurnErrorCode(event.code) ? event.code : classifyTurnError(message);
        updateCard(cardId, { error: { code, message }, retrying: undefined });
      } else if (event.type === 'retry') {
        updateCard(cardId, {
          retrying: {
            attempt: typeof event.attempt === 'number' ? event.attempt : 1,
            delayMs: typeof event.delayMs === 'number' ? event.delayMs : 0,
          },
        });
      }
    },
    onDone(cid) {
      runRecorder.succeed(cid);
      const cardId = cardByChat.current.get(cid);
      if (!cardId) return;
      updateCard(cardId, {
        // What arrived — never a leftover "Thinking...", which reads as still running.
        summary: textByChat.current.get(cid) ?? '',
        retrying: undefined,
        unread: true,
      });
    },
    onError(error, cid) {
      runRecorder.fail(error.message, cid);
      const cardId = cardByChat.current.get(cid);
      if (!cardId) return;
      updateCard(cardId, {
        summary: textByChat.current.get(cid) ?? '',
        error: turnErrorOf(error),
        retrying: undefined,
        unread: true,
      });
    },
  });

  /*
   * Run `prompt` into `cardId`, on a fresh chat id — a retry is a new turn, not
   * a resumption of the one that failed.
   *
   * THE chokepoint: whatever the user configured in Settings (tier grid + BYOK
   * providers) decides where this turn runs, exactly as on every other surface.
   * It used to post a hardcoded `model: 'sonnet'`, so a BYOK-only user had a
   * dead surface while every other one worked.
   */
  const runCard = useCallback(
    async (prompt: string, cardId: string, trigger: RunTrigger, attachments: AttachmentFile[] = []) => {
      const chatId = `assistant-${crypto.randomUUID()}`;
      cardByChat.current.set(chatId, cardId);
      chatByCard.current.set(cardId, chatId);
      textByChat.current.set(chatId, '');
      const route = resolveSendRoute(null, providers, {
        capability: CAPABILITY,
        tierModels,
        hasAnthropicKey,
        hasBedrock,
        known: builtinAccessKnown,
      });
      runRecorder.begin({ trigger, model: route?.model ?? undefined, chatId });
      const sending = sendMessage(prompt, chatId, 'assistant', route?.model ?? null, {
        // No question or connect card UI on this surface, so the turn must never
        // be parked waiting for one: false takes the documented "cannot ask"
        // path — the agent says what it would have done instead.
        canRelayToClient: false,
        providerConfig: route?.providerConfig,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      return { chatId, sending };
    },
    [providers, tierModels, hasAnthropicKey, hasBedrock, builtinAccessKnown, runRecorder, sendMessage],
  );

  /**
   * A new card and its turn. The prompt arrives as the ARGUMENT when a scheduled
   * job fires — reading the composer instead meant a job firing with an empty
   * composer did nothing, or ran whatever stale text was sitting in it.
   */
  const startCard = useCallback(
    async (prompt: string, opts: { trigger: RunTrigger; attachments?: AttachmentFile[]; fromComposer?: boolean }) => {
      const text = prompt.trim();
      if (!text) return;
      // Addressed by id: `addCard` PREPENDS, so a standing-order card landing
      // mid-stream would otherwise receive this turn's text.
      const cardId = addCard({ title: text, prompt: text, summary: 'Thinking...' });
      if (opts.fromComposer) setComposerCard(cardId);
      const { sending } = await runCard(text, cardId, opts.trigger, opts.attachments);
      await sending;
    },
    [addCard, runCard],
  );

  /** Stop one card's turn. What already arrived stays, marked as stopped. */
  const stopCard = useCallback((cardId: string) => {
    const chatId = chatByCard.current.get(cardId);
    if (!chatId) return;
    streamRegistry.abort(chatId, 'user');
    const text = textByChat.current.get(chatId) ?? '';
    // A Stop is not an error, but it IS an ending: "Thinking..." read as still running.
    updateCard(cardId, { summary: text ? `${text}\n\n_Stopped._` : 'Stopped.', retrying: undefined, unread: false });
  }, [updateCard]);

  /** Try again: the same prompt, into the same card. */
  const retryCard = useCallback((cardId: string) => {
    const card = useAssistantStore.getState().cards.find((c) => c.id === cardId);
    const prompt = card?.prompt;
    if (!prompt) return;
    updateCard(cardId, { summary: 'Thinking...', error: undefined, retrying: undefined });
    void runCard(prompt, cardId, 'manual').then(({ sending }) => sending);
  }, [runCard, updateCard]);

  // "Connect a model" instead of a card that can only fail.
  const modelReady = useModelReady(null, CAPABILITY);
  const [noModelAttempted, setNoModelAttempted] = useState(false);
  const submitFromComposer = useCallback(
    (text: string, attachments: AttachmentFile[]) => {
      if (!modelReady) {
        setNoModelAttempted(true);
        return false;
      }
      void startCard(text, { trigger: 'manual', attachments, fromComposer: true });
    },
    [modelReady, startCard],
  );

  /*
   * A due scheduled job runs HERE, through this surface's own turn — not
   * through a scheduler with a send path of its own. Every card is its own
   * conversation, so a job never waits behind (or supersedes) another card.
   */
  const runScheduled = useCallback((prompt: string) => startCard(prompt, { trigger: 'cron' }), [startCard]);
  useScheduledPrompt('assistant', runScheduled);

  const handleCardAction = useCallback((action: A2UIAction) => {
    if (action.type === 'button-click' && action.actionId !== 'reply' && action.actionId !== 'dismiss') {
      setComposerText('assistant', '', `Perform action: ${action.actionId}`);
    }
  }, []);

  /** A reply is a new turn that carries the card it answers. */
  const handleCardReply = useCallback((cardId: string, text: string) => {
    const card = useAssistantStore.getState().cards.find((c) => c.id === cardId);
    void startCard(buildCardReply(card, text), { trigger: 'manual' });
  }, [startCard]);

  return (
    <div className="flex h-full bg-background">
      {/* Left sidebar — schedules (standing orders) */}
      <OrdersSidebar
        orders={orders}
        onSelectOrder={setSelectedOrderId}
        selectedOrderId={openOrderId}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
        // Always through the dialog: every template now opens on its schedule,
        // so the user sees (and can change) when it will run before it does.
        onActivateTemplate={setActiveTemplate}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* View switch — the Assistant feed, or the Cockpit over runs. */}
        <div className="flex items-center gap-1 border-b border-border px-4 py-1.5">
          {(["feed", "cockpit"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                view === v
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "feed" ? "Activity" : "Cockpit"}
              {v === "feed" && health.length > 0 && (
                <span
                  className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
                  aria-label={`${health.length} schedule${health.length === 1 ? "" : "s"} need attention`}
                >
                  {health.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {view === "cockpit" ? (
          <Cockpit />
        ) : (
        <>
        {/* Input area — the shared Composer: Enter sends, Esc stops, IME-safe. */}
        <div className="px-4 py-3 border-b border-border">
          <div className="max-w-3xl mx-auto">
            <Composer
              surface="assistant"
              conversationId=""
              placeholder='Try: "Remind me every morning to check my emails" or "Watch my build and let me know if it fails"'
              onSubmit={submitFromComposer}
              isStreaming={isStreaming}
              onStop={() => stopCard(composerCard)}
              header={modelReady ? undefined : <NoModelCard attempted={noModelAttempted} />}
            />
          </div>
        </div>

        {/* Card feed */}
        <ScrollArea className="flex-1 overflow-hidden">
          <div className="max-w-5xl mx-auto px-4 py-4">
            <ScheduleHealth items={health} onOpenOrder={setSelectedOrderId} />
            {cards.length === 0 && orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Bot className="h-12 w-12 mb-4 opacity-30" />
                <h2 className="text-lg font-semibold text-foreground mb-2">Personal Assistant</h2>
                <p className="text-sm text-center max-w-md mb-3">
                  Create schedules to monitor, remind, and automate tasks.
                  Results appear here as interactive cards.
                </p>
                <p className="text-xs text-center max-w-md">
                  Ask above in plain words — &ldquo;remind me to stretch every 2 hours&rdquo; — or
                  pick a Quick Start template on the left.
                </p>
              </div>
            ) : (
              <>
                <CardFeed
                  cards={cards}
                  onAction={handleCardAction}
                  onReply={handleCardReply}
                  streaming={streamingCards}
                  onStop={stopCard}
                  onRetry={retryCard}
                />
              </>
            )}

            {/*
              * OUTSIDE the empty-state branch on purpose.
              *
              * A workspace with no assistant cards can still have hundreds of
              * runs behind it, and showing only prompt suggestions there is a
              * large part of why this tab and the Cockpit read as the same
              * screen: neither was showing what had actually happened.
              */}
            <RunLog runs={runs} now={runsNow} loading={runsLoading} />
          </div>
        </ScrollArea>
        </>
        )}

        {/* Status bar */}
        <StatusBar orders={orders} runs={runs} />
      </div>

      {/* Template customization dialog */}
      {activeTemplate && (
        <TemplateDialog
          template={activeTemplate}
          onClose={() => setActiveTemplate(null)}
        />
      )}

      {/* Order editor dialog */}
      {openOrderId && (
        <OrderEditor
          orderId={openOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}
