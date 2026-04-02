"use client";

import { useAppStore } from "@/stores/app-store";
import { useAssistantStore, type AssistantCard, type ActivityEntry } from "@/stores/assistant-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Clock,
  X,
  Bell,
  CheckCircle2,
  AlertCircle,
  Zap,
  ExternalLink,
  Eye,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getDayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  'order-created': <Zap className="h-3 w-3 text-green-500" />,
  'order-fired': <Bell className="h-3 w-3 text-blue-500" />,
  'order-completed': <CheckCircle2 className="h-3 w-3 text-muted-foreground" />,
  'order-paused': <Clock className="h-3 w-3 text-yellow-500" />,
  'order-error': <AlertCircle className="h-3 w-3 text-red-500" />,
  'user-action': <ChevronRight className="h-3 w-3 text-muted-foreground" />,
};

// ── Mini Card for standing order results ─────────────────────────────────────

function MiniCard({ card, onDismiss, onView }: { card: AssistantCard; onDismiss: () => void; onView: () => void }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 text-sm relative group transition-colors ${
      card.unread ? 'bg-primary/5 border border-primary/20' : 'bg-muted/40 border border-transparent'
    }`}>
      <div className="flex items-start gap-2">
        <Bell className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] text-muted-foreground tabular-nums">{formatTime(card.timestamp)}</span>
            {card.orderId && <span className="text-[10px] text-muted-foreground">Standing Order</span>}
          </div>
          <p className="text-xs font-medium text-foreground truncate">{card.title}</p>
          {card.summary && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{card.summary.slice(0, 150)}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <button
              onClick={onView}
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 font-medium transition-colors"
            >
              <Eye className="h-3 w-3" /> View
            </button>
            <button
              onClick={onDismiss}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              <X className="h-3 w-3" /> Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Activity Entry ───────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5 shrink-0">
        {ACTIVITY_ICONS[entry.type] || <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground tabular-nums">{formatTime(entry.timestamp)}</span>
        </div>
        <p className="text-[11px] text-foreground">{entry.label}</p>
        {entry.detail && <p className="text-[10px] text-muted-foreground">{entry.detail}</p>}
      </div>
    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

export function HeartbeatPanel() {
  const heartbeatPanelOpen = useAppStore((s) => s.heartbeatPanelOpen);
  const setHeartbeatPanelOpen = useAppStore((s) => s.setHeartbeatPanelOpen);
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);

  const cards = useAssistantStore((s) => s.cards);
  const activity = useAssistantStore((s) => s.activity);
  const dismissCard = useAssistantStore((s) => s.dismissCard);
  const markAllRead = useAssistantStore((s) => s.markAllRead);

  const unreadCards = cards.filter((c) => c.unread);
  const recentCards = cards.slice(0, 10);
  const recentActivity = activity.slice(0, 20);

  const hasContent = recentCards.length > 0 || recentActivity.length > 0;

  // Group cards by day
  const cardGroups: { label: string; cards: AssistantCard[] }[] = [];
  for (const card of recentCards) {
    const label = getDayLabel(card.timestamp);
    const existing = cardGroups.find((g) => g.label === label);
    if (existing) existing.cards.push(card);
    else cardGroups.push({ label, cards: [card] });
  }

  const handleViewCard = () => {
    setActiveSurface('assistant');
    setHeartbeatPanelOpen(false);
  };

  return (
    <Sheet
      open={heartbeatPanelOpen}
      onOpenChange={(o) => {
        if (!o) setHeartbeatPanelOpen(false);
      }}
    >
      <SheetContent
        side="left"
        className="w-[340px] sm:max-w-[340px] overflow-hidden flex flex-col p-0"
        showCloseButton
      >
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-sm font-semibold flex-1">Updates</SheetTitle>
            {unreadCards.length > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
                {unreadCards.length > 9 ? "9+" : unreadCards.length}
              </span>
            )}
            {unreadCards.length > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
          <SheetDescription className="sr-only">
            Activity feed from standing orders and the assistant
          </SheetDescription>
        </SheetHeader>

        {!hasContent ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No updates yet. Standing order results, reminders, and alerts will appear here.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setActiveSurface('assistant'); setHeartbeatPanelOpen(false); }}
            >
              Go to Assistant
            </Button>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="px-3 py-2 space-y-4">
              {/* Cards (results, reminders) */}
              {cardGroups.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
                    {group.label}
                  </p>
                  <div className="space-y-2">
                    {group.cards.map((card) => (
                      <MiniCard
                        key={card.id}
                        card={card}
                        onDismiss={() => dismissCard(card.id)}
                        onView={handleViewCard}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Activity log */}
              {recentActivity.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
                    Activity
                  </p>
                  <div className="space-y-0.5 px-1">
                    {recentActivity.slice(0, 10).map((entry) => (
                      <ActivityRow key={entry.id} entry={entry} />
                    ))}
                  </div>
                </div>
              )}

              {/* Link to full assistant */}
              <button
                onClick={() => { setActiveSurface('assistant'); setHeartbeatPanelOpen(false); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-2 border-t border-border/30 flex items-center justify-center gap-1 transition-colors"
              >
                View all in Assistant <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
