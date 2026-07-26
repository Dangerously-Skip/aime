"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAssistantStore, type StandingOrder, type AssistantCard } from "@/stores/assistant-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useHydrated } from "@/components/store-hydration";
import { useStandingOrders } from "@/hooks/use-standing-orders";
import { useAssistantWidgets } from "@/hooks/use-assistant-widgets";
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
  CloudSun,
  TrendingUp,
  Globe2,
  type LucideIcon,
} from "lucide-react";
import { WIDGET_PRESETS, buildWidgetCard } from "@/lib/assistant/widget-presets";

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  sun: Sun, moon: Moon, timer: Timer, hammer: Hammer,
  'book-open': BookOpen, 'git-pull-request': GitPullRequest,
};

const WIDGET_ICONS: Record<string, LucideIcon> = {
  'cloud-sun': CloudSun,
  'trending-up': TrendingUp,
  'globe-2': Globe2,
};
import { STANDING_ORDER_TEMPLATES, type StandingOrderTemplate } from "@/lib/standing-order-templates";
import { TemplateDialog } from "./template-dialog";
import { OrderEditor } from "./order-editor";
import { exportOrdersToJson } from "@/lib/standing-order-yaml";
import { Cockpit } from "./cockpit";
import { useWidgetRefresh } from "@/hooks/use-widget-refresh";
import { handleWidgetCreateEvent } from "@/lib/widgets/handle-create-event";

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
      <div className="w-10 border-r border-border flex flex-col items-center pt-2">
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
    <div className="w-[220px] border-r border-border flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
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
          <div className="border-t border-border mt-2 pt-2">
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

  const orders = useAssistantStore((s) => s.orders);
  const cards = useAssistantStore((s) => s.cards);
  const addCard = useAssistantStore((s) => s.addCard);
  const addOrder = useAssistantStore((s) => s.addOrder);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);

  // Hydrate store on mount
  useEffect(() => {
    if (hydrated) {
      useAssistantStore.persist.rehydrate();
    }
  }, [hydrated]);

  // Standing order trigger engine
  useStandingOrders();
  useWidgetRefresh();

  // Auto-refresh dashboard widgets on the heartbeat
  useAssistantWidgets();

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

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || isStreaming) return;
    const prompt = inputValue.trim();
    setInputValue("");
    setIsStreaming(true);

    // Add a "thinking" card
    addCard({ title: prompt, summary: 'Thinking...' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const chatId = `assistant-${Date.now()}`;
      const response = await fetch('/api/chat/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: prompt,
          chatId,
          model: 'sonnet',
          apiKey: anthropicApiKey || undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        // Update the thinking card with error
        useAssistantStore.setState((s) => ({
          cards: s.cards.map((c, i) => i === 0 ? { ...c, summary: `Error: ${response.statusText}` } : c),
        }));
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'text' && typeof event.content === 'string') {
              fullText += event.content;
              // Update the first card with streamed text
              useAssistantStore.setState((s) => ({
                cards: s.cards.map((c, i) => i === 0 ? { ...c, summary: fullText } : c),
              }));
            } else if (event.type === 'widget_create' && event.input) {
              handleWidgetCreateEvent(event as Record<string, unknown>);
            } else if (event.type === 'standing_order_create' && event.input) {
              const input = event.input as {
                instruction: string; trigger_type: string; expression?: string;
                condition?: string; completionCondition?: string; agentName?: string;
                notifyVia?: string; maxExecutions?: number; expiresInHours?: number;
              };
              useAssistantStore.getState().addOrder({
                instruction: input.instruction,
                agentName: input.agentName,
                trigger: {
                  type: (input.trigger_type as 'cron' | 'interval') || 'interval',
                  expression: input.expression,
                },
                condition: input.condition,
                completionCondition: input.completionCondition,
                notifyVia: input.notifyVia || 'assistant',
                maxExecutions: input.maxExecutions,
                expiresAt: input.expiresInHours ? Date.now() + input.expiresInHours * 3600000 : undefined,
              });
            } else if (event.type === 'cron_create' && event.input) {
              // Also handle cron_create events — migrate to standing orders
              const input = event.input as { expression: string; prompt: string };
              if (input.expression && input.prompt) {
                useAssistantStore.getState().addOrder({
                  instruction: input.prompt,
                  trigger: { type: 'cron', expression: input.expression },
                  notifyVia: 'assistant',
                });
              }
            }
          } catch { /* ignore parse errors */ }
        }
      }

      // Final update — replace summary with completed text
      if (fullText) {
        useAssistantStore.setState((s) => ({
          cards: s.cards.map((c, i) => i === 0 ? { ...c, summary: fullText, unread: true } : c),
        }));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      useAssistantStore.setState((s) => ({
        cards: s.cards.map((c, i) => i === 0 ? { ...c, summary: `Error: ${err instanceof Error ? err.message : String(err)}` } : c),
      }));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [inputValue, isStreaming, anthropicApiKey, addCard]);

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
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
    setInputValue(context + text);
    // Auto-submit
    setTimeout(() => {
      const btn = document.querySelector('[data-assistant-submit]') as HTMLButtonElement;
      btn?.click();
    }, 50);
  }, []);

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
                  onClick={isStreaming ? handleAbort : handleSubmit}
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

                {/* Dashboard widgets */}
                <div className="mt-8 max-w-md w-full">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 text-center">Dashboard widgets</h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {WIDGET_PRESETS.map((preset) => {
                      const Icon = WIDGET_ICONS[preset.icon] ?? Bot;
                      return (
                        <button
                          key={preset.id}
                          className="flex flex-col items-center gap-1.5 text-center p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                          onClick={() => addCard(buildWidgetCard(preset))}
                          title={preset.description}
                        >
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Add widget toolbar */}
                <div className="flex items-center justify-end mb-3 gap-1.5">
                  <span className="text-[11px] text-muted-foreground mr-1">Add widget:</span>
                  {WIDGET_PRESETS.map((preset) => {
                    const Icon = WIDGET_ICONS[preset.icon] ?? Bot;
                    return (
                      <button
                        key={preset.id}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        onClick={() => addCard(buildWidgetCard(preset))}
                        title={preset.description}
                      >
                        <Icon className="h-3 w-3" />
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <CardFeed cards={cards} onAction={handleCardAction} onReply={handleCardReply} />
              </>
            )}
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
