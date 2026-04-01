"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAssistantStore, type StandingOrder, type AssistantCard } from "@/stores/assistant-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { useHydrated } from "@/components/store-hydration";
import { useStandingOrders } from "@/hooks/use-standing-orders";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { A2UIDocumentRenderer } from "@/lib/a2ui/renderer";
import type { A2UIAction } from "@/lib/a2ui/types";
import {
  ArrowUp,
  Square,
  Play,
  Pause,
  Trash2,
  Pin,
  PinOff,
  X,
  Clock,
  Zap,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  Bot,
} from "lucide-react";

// ── Orders Sidebar ───────────────────────────────────────────────────────────

function OrdersSidebar({
  orders,
  onSelectOrder,
  selectedOrderId,
  collapsed,
  onToggleCollapsed,
}: {
  orders: StandingOrder[];
  onSelectOrder: (id: string | null) => void;
  selectedOrderId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const pauseOrder = useAssistantStore((s) => s.pauseOrder);
  const resumeOrder = useAssistantStore((s) => s.resumeOrder);

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
              <div className="truncate text-xs">{order.instruction.slice(0, 50)}</div>
              <div className="text-xs text-muted-foreground truncate">{triggerLabel(order)}</div>
            </div>
            {order.status === 'active' && (
              <button
                className="hidden group-hover:block shrink-0"
                onClick={(e) => { e.stopPropagation(); pauseOrder(order.id); }}
                title="Pause"
              >
                <Pause className="h-3 w-3 text-muted-foreground hover:text-yellow-500" />
              </button>
            )}
            {order.status === 'paused' && (
              <button
                className="hidden group-hover:block shrink-0"
                onClick={(e) => { e.stopPropagation(); resumeOrder(order.id); }}
                title="Resume"
              >
                <Play className="h-3 w-3 text-muted-foreground hover:text-green-500" />
              </button>
            )}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="w-[220px] border-r border-border flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Standing Orders</span>
        <Button variant="ghost" size="icon-sm" onClick={onToggleCollapsed} title="Collapse sidebar">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-2">
          {orders.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              <Clock className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No standing orders yet.
              <br />
              Try: "Remind me every day at 9am to check my emails"
            </div>
          ) : (
            <>
              {renderOrderGroup('Active', activeOrders)}
              {renderOrderGroup('Paused', pausedOrders)}
              {renderOrderGroup('Completed', completedOrders)}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Card Feed ────────────────────────────────────────────────────────────────

function CardFeed({
  cards,
  onAction,
}: {
  cards: AssistantCard[];
  onAction?: (action: A2UIAction) => void;
}) {
  const dismissCard = useAssistantStore((s) => s.dismissCard);
  const pinCard = useAssistantStore((s) => s.pinCard);
  const unpinCard = useAssistantStore((s) => s.unpinCard);

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

  return (
    <div className="space-y-4">
      {sortedCards.map((card) => (
        <div
          key={card.id}
          className={`rounded-lg border bg-card shadow-sm overflow-hidden ${
            card.unread ? 'border-l-2 border-l-primary border-r border-t border-b border-border' : 'border-border'
          }`}
        >
          {/* Card header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium truncate">{card.title}</span>
              {card.pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-muted-foreground">
                {new Date(card.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => card.pinned ? unpinCard(card.id) : pinCard(card.id)}
                title={card.pinned ? "Unpin" : "Pin"}
              >
                {card.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => dismissCard(card.id)}
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Card body */}
          {card.doc ? (
            <A2UIDocumentRenderer doc={card.doc} onAction={onAction} />
          ) : card.summary ? (
            <div className="px-4 py-3 text-sm">{card.summary}</div>
          ) : null}
        </div>
      ))}
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
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const orders = useAssistantStore((s) => s.orders);
  const cards = useAssistantStore((s) => s.cards);
  const addCard = useAssistantStore((s) => s.addCard);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);

  // Hydrate store on mount
  useEffect(() => {
    if (hydrated) {
      useAssistantStore.persist.rehydrate();
    }
  }, [hydrated]);

  // Standing order trigger engine
  useStandingOrders();

  const handleSubmit = useCallback(async () => {
    if (!inputValue.trim() || isStreaming) return;
    const prompt = inputValue.trim();
    setInputValue("");
    setIsStreaming(true);

    // Add a "thinking" card
    const thinkingId = crypto.randomUUID();
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
          apiKey: nibGatewayApiKey || undefined,
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
  }, [inputValue, isStreaming, nibGatewayApiKey, addCard]);

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
    // Route state mutations directly, agent actions as new prompts
    if (action.type === 'button-click') {
      // Could trigger a new assistant query with the action context
      setInputValue(`Perform action: ${action.actionId}`);
    }
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
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
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
        <ScrollArea className="flex-1">
          <div className="max-w-3xl mx-auto px-4 py-4">
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
                    className="text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Give me a morning briefing every weekday at 9am")}
                  >
                    <span className="font-medium">Morning briefing</span>
                    <br />
                    <span className="text-muted-foreground">Daily summary at 9am</span>
                  </button>
                  <button
                    className="text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Remind me to stretch every 2 hours")}
                  >
                    <span className="font-medium">Stretch reminder</span>
                    <br />
                    <span className="text-muted-foreground">Every 2 hours</span>
                  </button>
                  <button
                    className="text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Watch my latest Buildkite build and alert me if it fails")}
                  >
                    <span className="font-medium">Build monitor</span>
                    <br />
                    <span className="text-muted-foreground">Alert on failure</span>
                  </button>
                  <button
                    className="text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    onClick={() => setInputValue("Make me a to-do list for today")}
                  >
                    <span className="font-medium">Daily to-do</span>
                    <br />
                    <span className="text-muted-foreground">Interactive checklist</span>
                  </button>
                </div>
              </div>
            ) : (
              <CardFeed cards={cards} onAction={handleCardAction} />
            )}
          </div>
        </ScrollArea>

        {/* Status bar */}
        <StatusBar orders={orders} />
      </div>
    </div>
  );
}
