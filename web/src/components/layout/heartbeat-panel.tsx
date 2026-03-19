"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useHeartbeatStore } from "@/stores/heartbeat-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, X } from "lucide-react";

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

export function HeartbeatPanel() {
  const heartbeatPanelOpen = useAppStore((s) => s.heartbeatPanelOpen);
  const setHeartbeatPanelOpen = useAppStore((s) => s.setHeartbeatPanelOpen);
  const entries = useHeartbeatStore((s) => s.entries);
  const markAllRead = useHeartbeatStore((s) => s.markAllRead);
  const dismissEntry = useHeartbeatStore((s) => s.dismissEntry);
  const unreadCount = entries.filter((e) => e.unread).length;

  const panelRef = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    if (!heartbeatPanelOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setHeartbeatPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [heartbeatPanelOpen, setHeartbeatPanelOpen]);

  if (!heartbeatPanelOpen) return null;

  // Group entries by day label
  const groups: { label: string; entries: typeof entries }[] = [];
  for (const entry of entries) {
    const label = getDayLabel(entry.timestamp);
    const existing = groups.find((g) => g.label === label);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }

  return (
    <div
      ref={panelRef}
      className="fixed top-0 bottom-0 z-40 flex flex-col bg-background border-r border-border shadow-lg"
      style={{ left: 250, width: 320 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <span className="font-semibold text-sm flex-1">Updates</span>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Mark all read
          </button>
        )}
        <button
          onClick={() => setHeartbeatPanelOpen(false)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Clock className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No updates yet. Heartbeat will surface brief summaries here.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-3 py-2 space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-1.5">
                  {group.label}
                </p>
                <div className="space-y-1.5">
                  {group.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded-lg px-3 py-2.5 text-sm relative group ${
                        entry.unread ? "bg-primary/5 border border-primary/20" : "bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] text-muted-foreground mb-1">
                            {formatTime(entry.timestamp)}
                          </p>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap">{entry.summary}</p>
                        </div>
                        <button
                          onClick={() => dismissEntry(entry.id)}
                          className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
