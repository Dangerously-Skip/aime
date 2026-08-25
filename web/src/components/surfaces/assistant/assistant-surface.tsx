"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAssistantStore, type StandingOrder, type AssistantCard } from "@/stores/assistant-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useHydrated } from "@/components/store-hydration";
import { useStandingOrders } from "@/hooks/use-standing-orders";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { A2UIDocumentRenderer } from "@/lib/a2ui/renderer";
import type { A2UIAction } from "@/lib/a2ui/types";
import { MarkdownRenderer } from "@/components/shared/markdown-renderer";
import {
  ArrowUp,
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
  ListChecks,
  type LucideIcon,
} from "lucide-react";

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  sun: Sun, moon: Moon, timer: Timer, hammer: Hammer,
  'book-open': BookOpen, 'git-pull-request': GitPullRequest,
};

import { STANDING_ORDER_TEMPLATES, type StandingOrderTemplate } from "@/lib/standing-order-templates";
import { TemplateDialog } from "./template-dialog";
import { OrderEditor } from "./order-editor";
import { exportOrdersToJson } from "@/lib/standing-order-yaml";
import { Cockpit } from "./cockpit";
import { RunLog } from "@/components/runs/run-log";
import { useRunLog } from "@/components/runs/use-run-log";
import { useWidgetRefresh } from "@/hooks/use-widget-refresh";
import { handleAgnosticChunk } from "@/lib/sse/agnostic-chunks";
import { readTurnEvents } from "@/lib/sse/turn-events";
import { useScheduledPrompt } from "@/hooks/use-scheduled-prompt";
import { resolveSendRoute } from "@/lib/models/client-options";
import { getSurfaceRoute } from "@/lib/models/surface-routes";
import { useProviderStore } from "@/stores/provider-store";
import { useBuiltinAccess } from "@/hooks/use-builtin-access";

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

  const triggerLabel = (order: StandingOrder) => {
    if (order.trigger.type === 'cron' && order.trigger.expression) return order.trigger.expression;
    if (order.trigger.type === 'interval' && order.trigger.expression) return `every ${order.trigger.expression}`;
    if (order.trigger.type === 'event' && order.trigger.event) return `on ${order.trigger.event}`;
    return order.trigger.type;
  };

  if (collapsed) {
    return (
      <div className="w-12 p-2 flex flex-col items-center">
        <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} title="Expand sidebar">
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
          <button
            key={order.id}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-start gap-2 group ${
              selectedOrderId === order.id ? 'bg-muted' : ''
            }`}
            onClick={() => onSelectOrder(selectedOrderId === order.id ? null : order.id)}
          >
            {statusIcon(order.status)}
            <div className="flex-1 min-w-0">
              <div className="truncate text-xs" title={order.instruction}>{order.instruction}</div>
              <div className="text-xs text-muted-foreground truncate">{triggerLabel(order)}</div>
            </div>
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              {order.status === 'active' && (
                <button
                  onClick={(e) => { e.stopPropagation(); pauseOrder(order.id); }}
                  title="Pause"
                >
                  <Pause className="h-3 w-3 text-muted-foreground hover:text-yellow-500" />
                </button>
              )}
              {order.status === 'paused' && (
                <button
                  onClick={(e) => { e.stopPropagation(); resumeOrder(order.id); }}
                  title="Resume"
                >
                  <Play className="h-3 w-3 text-muted-foreground hover:text-green-500" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); removeOrder(order.id); }}
                title="Delete"
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="w-[220px] p-2 flex flex-col shrink-0">
      <div className="surface-well flex flex-1 min-h-0 flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Standing Orders</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost" size="icon-sm"
            onClick={() => exportOrdersToJson(orders)}
            title="Export orders"
            disabled={orders.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} title="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-2">
          {orders.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              <Clock className="h-5 w-5 mx-auto mb-1.5 opacity-40" />
              No standing orders yet
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

function CardWidget({
  card,
  onAction,
  onReply,
  expanded,
  onToggleExpand,
}: {
  card: AssistantCard;
  onAction?: (action: A2UIAction) => void;
  onReply: (cardId: string, text: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const dismissCard = useAssistantStore((s) => s.dismissCard);
  const pinCard = useAssistantStore((s) => s.pinCard);
  const unpinCard = useAssistantStore((s) => s.unpinCard);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');

  const hasA2UIDoc = !!card.doc;
  const isLong = (card.summary?.length || 0) > 300;
  const hasQuestion = card.summary && (/\?[\s]*$/.test(card.summary.trim()) || /would you|could you|do you|what|when|how|which/i.test(card.summary));

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm hover:shadow-md transition-all overflow-hidden">
      {/* Header — clean, no colored strips */}
      <div className="flex items-start justify-between px-5 pt-4 pb-1">
        <div className="flex-1 min-w-0 pr-2">
          <p className="text-sm font-semibold text-foreground leading-snug">{card.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            {new Date(card.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {card.pinned && ' · Pinned'}
            {card.unread && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary ml-1.5 align-middle" />}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => dismissCard(card.id)} className="shrink-0 -mt-1 -mr-2 opacity-0 group-hover:opacity-100 hover:opacity-100" title="Dismiss">
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
}: {
  cards: AssistantCard[];
  onAction?: (action: A2UIAction) => void;
  onReply: (cardId: string, text: string) => void;
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

function StatusBar({ orders }: { orders: StandingOrder[] }) {
  const activeCount = orders.filter((o) => o.status === 'active').length;
  const unreadCount = useAssistantStore((s) => s.cards.filter((c) => c.unread).length);
  const totalRuns = orders.reduce((sum, o) => sum + o.runCount, 0);

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border text-xs text-muted-foreground">
      <span>{activeCount} active order{activeCount !== 1 ? 's' : ''}</span>
      {unreadCount > 0 && <span className="text-primary">{unreadCount} unread</span>}
      <span>{totalRuns} total run{totalRuns !== 1 ? 's' : ''}</span>
    </div>
  );
}

// ── Main Surface ─────────────────────────────────────────────────────────────

const CAPABILITY = getSurfaceRoute("assistant").capability;

/**
 * Same budget, same reasoning as use-sse-stream: the server heartbeats every
 * ~15s, so 120s without a byte means the connection is dead.
 */
const STREAM_INACTIVITY_TIMEOUT_MS = 120_000;

export function AssistantSurface() {
  const hydrated = useHydrated();
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Assistant feed vs. Cockpit (scheduled work + run outcomes). */
  const [view, setView] = useState<"feed" | "cockpit">("feed");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<StandingOrderTemplate | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Mirrored for callbacks that must read it without re-subscribing — the
   * scheduled-prompt hook holds its guard in a ref, so a stale closure here
   * would let a job fire mid-turn.
   */
  const isStreamingRef = useRef(false);

  const orders = useAssistantStore((s) => s.orders);
  const cards = useAssistantStore((s) => s.cards);
  const addCard = useAssistantStore((s) => s.addCard);
  const updateCard = useAssistantStore((s) => s.updateCard);


  const addOrder = useAssistantStore((s) => s.addOrder);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  // The route comes from the SAME `resolveSendRoute` chokepoint every other
  // surface uses — see the comment at the fetch below.
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

  // Auto-refresh dashboard widgets on the heartbeat

  // Clear selection when the selected order is deleted
  useEffect(() => {
    if (selectedOrderId && !orders.find((o) => o.id === selectedOrderId)) {
      setSelectedOrderId(null);
    }
  }, [orders, selectedOrderId]);

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

  /**
   * The prompt arrives as the ARGUMENT when a scheduled job fires —
   * `useScheduledPrompt` dispatches it that way, and discarding the argument to
   * read the composer instead meant a job firing with an empty composer was
   * consumed from the bus and silently did nothing (or ran whatever stale text
   * happened to be sitting in it). A typed submit passes nothing and reads the
   * composer.
   */
  const handleSubmit = useCallback(async (scheduledPrompt?: string) => {
    const prompt = (scheduledPrompt ?? inputValue).trim();
    if (!prompt || isStreaming) return;
    setInputValue("");
    setIsStreaming(true);
    isStreamingRef.current = true;

    // THE chokepoint: whatever the user configured in Settings (tier grid +
    // BYOK providers) decides where this turn runs, exactly as on every other
    // surface. It used to post a hardcoded `model: 'sonnet'`, which skipped
    // registry resolution server-side entirely — so the tier grid never
    // governed this surface, and a BYOK/OpenRouter-only user had a dead
    // surface while every other one worked. Omitted when it resolves to
    // nothing, leaving the server's own fallback in charge.
    const route = resolveSendRoute(null, providers, {
      capability: CAPABILITY,
      tierModels,
      hasAnthropicKey,
      hasBedrock,
      known: builtinAccessKnown,
    });

    // Capture the card ID. `addCard` PREPENDS, so an index-0 update races any
    // standing-order card landing mid-stream (`useStandingOrders` runs on this
    // same surface): the streamed text would land on whichever card was newest.
    const cardId = addCard({ title: prompt, summary: 'Thinking...' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const chatId = `assistant-${Date.now()}`;
      // No question/connector card UI on this surface, so the turn must never
      // be parked waiting for one. `canRelayToClient` defaults to TRUE, which
      // meant the provider was handed onInputRequest/onConnectorRequest and
      // would block for 300s on an approval nobody could answer. Declaring
      // false takes the documented "cannot ask" path: canUseTool refuses and
      // tells the agent to say what it would have done.
      const response = await fetch('/api/chat/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canRelayToClient: false,
          message: prompt,
          chatId,
          ...(route?.model ? { model: route.model } : {}),
          ...(route?.providerConfig ? { providerConfig: route.providerConfig } : {}),
          apiKey: anthropicApiKey || undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        // The body carries the server's own words (auth failures, unknown
        // surfaces); statusText is frequently empty in fetch.
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        updateCard(cardId, {
          summary: body.error ?? `Request failed (${response.status}).`,
          unread: true,
        });
        setIsStreaming(false);
        return;
      }

      let fullText = '';
      /** Set by an SSE `error` event; reported once the stream ends. */
      let streamError: string | null = null;

      /*
       * The client-side backstop every other surface gets from use-sse-stream:
       * without it a wedged stream (sleep, black-holed TCP) left this surface
       * streaming forever, and — because scheduled prompts defer while busy —
       * every later standing-order run queued behind a dead connection. Safe
       * against long tool runs: the server sends heartbeat comments ~15s, so
       * only genuine silence trips it.
       */
      await readTurnEvents(
        response.body,
        (event) => {
          if (event.type === 'text' && typeof event.content === 'string') {
            fullText += event.content;
            updateCard(cardId, { summary: fullText });
          } else if (
            event.type === 'error' &&
            typeof event.message === 'string' &&
            event.message
          ) {
            /*
             * Every server-side failure arrives here — watchdog kills,
             * silence timeouts, model/auth errors. Dropped, they left the card
             * saying "Thinking..." forever on exactly the surface whose work
             * runs unattended. Kept aside rather than written straight into
             * the summary so a late text chunk cannot overwrite the error
             * away; the final update below composes both.
             */
            streamError = event.message;
          } else if (handleAgnosticChunk(event as Record<string, unknown>, {
            chatId,
            surface: 'Assistant',
            // This surface owns the order feed, so a created order shows there
            // rather than as a toast. The only genuinely surface-specific part.
            notifyVia: 'assistant',
          })) {
            // handled centrally — see lib/sse/agnostic-chunks
          }
        },
        { inactivityTimeoutMs: STREAM_INACTIVITY_TIMEOUT_MS },
      );

      // Final update — completed text, or the error, or both when a run failed
      // after producing something worth keeping.
      if (streamError) {
        updateCard(cardId, {
          summary: fullText ? `${fullText}\n\n_${streamError}_` : `Error: ${streamError}`,
          unread: true,
        });
      } else if (fullText) {
        updateCard(cardId, { summary: fullText, unread: true });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      updateCard(cardId, {
        summary: `Error: ${err instanceof Error ? err.message : String(err)}`,
        unread: true,
      });
    } finally {
      setIsStreaming(false);
      isStreamingRef.current = false;
      abortRef.current = null;
    }
  }, [inputValue, isStreaming, anthropicApiKey, addCard, updateCard, providers, tierModels, hasAnthropicKey, hasBedrock, builtinAccessKnown]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    isStreamingRef.current = false;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) handleAbort();
        else handleSubmit();
      }
    },
    [handleSubmit, handleAbort, isStreaming]
  );

  /*
   * A due cron job runs HERE, through this surface's own submit — not through a
   * scheduler with a send path of its own, which would be a fourth place that
   * starts a turn. Before this, a job published to the bus, switched surface,
   * and nothing ran it. Busy (streaming) defers the job instead of dropping it.
   */
  useScheduledPrompt('assistant', handleSubmit, () => isStreamingRef.current);

  const handleCardAction = useCallback((action: A2UIAction) => {
    console.log('[Assistant] Card action:', action);
    if (action.type === 'button-click' && action.actionId !== 'reply' && action.actionId !== 'dismiss') {
      setInputValue(`Perform action: ${action.actionId}`);
    }
  }, []);

  const handleCardReply = useCallback((cardId: string, text: string) => {
    // Find the card to get context
    const card = useAssistantStore.getState().cards.find((c) => c.id === cardId);
    const context = card ? `Regarding "${card.title}": ` : '';
    /*
     * Submit directly with the prompt as the argument. This used to set the
     * composer and click `[data-assistant-submit]` after 50ms — which raced
     * React's state flush (a disabled button swallows the reply) and, if a
     * turn had started in between, clicked what is then the STOP button,
     * aborting a live run.
     */
    void handleSubmit(context + text);
  }, [handleSubmit]);

  return (
    <div className="flex h-full bg-background">
      {/* Left sidebar — Standing Orders */}
      <OrdersSidebar
        orders={orders}
        onSelectOrder={setSelectedOrderId}
        selectedOrderId={selectedOrderId}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
        onActivateTemplate={(tpl) => {
          if (tpl.parameters && tpl.parameters.length > 0) {
            setActiveTemplate(tpl);
          } else {
            addOrder(tpl.buildOrder());
          }
        }}
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
            </button>
          ))}
        </div>
        {view === "cockpit" ? (
          <Cockpit />
        ) : (
        <>
        {/* Input area */}
        <div className="px-4 py-3 border-b border-border">
          <div className="max-w-3xl mx-auto">
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <Textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='Try: "Remind me every morning to check my emails" or "Watch my build and let me know if it fails"'
                rows={2}
                className="min-h-[56px] max-h-[120px] resize-none border-0 bg-transparent text-sm focus-visible:ring-0 focus-visible:ring-offset-0 p-4 pb-0"
              />
              <div className="flex items-center justify-end px-4 py-2">
                <Button
                  size="icon"
                  data-assistant-submit
                  className={`h-8 w-8 rounded-lg ${isStreaming ? 'bg-destructive hover:bg-destructive/80' : 'bg-primary hover:bg-primary/80'}`}
                  // Wrapped: a bare handler reference would receive the click
                  // event as `scheduledPrompt`.
                  onClick={isStreaming ? handleAbort : () => handleSubmit()}
                  disabled={!isStreaming && !inputValue.trim()}
                >
                  {isStreaming ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Card feed */}
        <ScrollArea className="flex-1 overflow-hidden">
          <div className="max-w-5xl mx-auto px-4 py-4">
            {cards.length === 0 && orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Bot className="h-12 w-12 mb-4 opacity-30" />
                <h2 className="text-lg font-semibold text-foreground mb-2">Personal Assistant</h2>
                <p className="text-sm text-center max-w-md mb-6">
                  Create standing orders to monitor, schedule, and automate tasks.
                  Results appear here as interactive cards.
                </p>
                <div className="grid grid-cols-2 gap-3 text-xs max-w-md">
                  <button
                    className="flex items-start gap-2.5 text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Give me a morning briefing every weekday at 9am")}
                  >
                    <Sun className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">Morning briefing</span>
                      <br />
                      <span className="text-muted-foreground">Daily summary at 9am</span>
                    </div>
                  </button>
                  <button
                    className="flex items-start gap-2.5 text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Remind me to stretch every 2 hours")}
                  >
                    <Timer className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">Stretch reminder</span>
                      <br />
                      <span className="text-muted-foreground">Every 2 hours</span>
                    </div>
                  </button>
                  <button
                    className="flex items-start gap-2.5 text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Watch my latest Buildkite build and alert me if it fails")}
                  >
                    <Hammer className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">Build monitor</span>
                      <br />
                      <span className="text-muted-foreground">Alert on failure</span>
                    </div>
                  </button>
                  <button
                    className="flex items-start gap-2.5 text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Make me a to-do list for today")}
                  >
                    <ListChecks className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium">Daily to-do</span>
                      <br />
                      <span className="text-muted-foreground">Interactive checklist</span>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <CardFeed cards={cards} onAction={handleCardAction} onReply={handleCardReply} />
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
        <StatusBar orders={orders} />
      </div>

      {/* Template customization dialog */}
      {activeTemplate && (
        <TemplateDialog
          template={activeTemplate}
          onClose={() => setActiveTemplate(null)}
        />
      )}

      {/* Order editor dialog */}
      {selectedOrderId && (
        <OrderEditor
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}
    </div>
  );
}
