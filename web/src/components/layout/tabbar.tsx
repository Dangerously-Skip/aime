"use client";

import { useEffect } from "react";
import { useAppStore, type Surface } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useContextBusStore } from "@/stores/context-bus-store";
import { useWidgetStore } from "@/stores/widget-store";
import { unreadCount as unreadCountOf } from "@/lib/widgets/unread";
import {
  PanelLeftClose,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const SURFACES: { id: Surface; label: string; shortcut: string }[] = [
  { id: "chat", label: "Chat", shortcut: "1" },
  { id: "cowork", label: "Cowork", shortcut: "2" },
  { id: "code", label: "Code", shortcut: "3" },
  { id: "browser", label: "Browser", shortcut: "4" },
  { id: "assistant", label: "Assistant", shortcut: "5" },
];

interface TabbarProps {
  isElectron?: boolean;
}

export function Tabbar({ isElectron = false }: TabbarProps) {
  const activeSurface = useAppStore((s) => s.activeSurface);
  const unreadWidgets = useWidgetStore((s) => unreadCountOf(s.widgets));
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const goBack = useConversationStore((s) => s.goBack);
  const goForward = useConversationStore((s) => s.goForward);
  const canGoBack = useConversationStore((s) => s.canGoBack());
  const canGoForward = useConversationStore((s) => s.canGoForward());
  // Subscribed once here (not per-tab inside the map below) — hooks must not be
  // called conditionally or in a loop. Badge counts are derived per surface.
  const busEvents = useContextBusStore((s) => s.events);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= 4) {
        e.preventDefault();
        setActiveSurface(SURFACES[num - 1].id);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setActiveSurface]);

  return (
    <div
      className="flex items-center h-11 px-3 border-b border-border bg-background shrink-0"
      style={{
        // Make the entire tabbar draggable in Electron
        WebkitAppRegion: isElectron ? "drag" : undefined,
        // Add left padding for traffic lights when sidebar is hidden
        paddingLeft: isElectron && !sidebarVisible ? "5rem" : undefined,
      } as React.CSSProperties}
    >
      {/* Sidebar toggle — must be no-drag */}
      <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={toggleSidebar}
        >
          {sidebarVisible ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Back/forward navigation */}
      <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          onClick={goBack}
          disabled={!canGoBack}
          title="Go back"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          onClick={goForward}
          disabled={!canGoForward}
          title="Go forward"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Tab pills — must be no-drag */}
      <div
        className="flex items-center gap-1 rounded-lg bg-muted/60 p-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {SURFACES.map((surface) => {
          const isActive = activeSurface === surface.id;
          const unreadCount =
            busEvents.filter(
              e => !e.consumed && (e.priority === 'p0' || e.priority === 'p1') && (!e.targetSurface || e.targetSurface === surface.id)
            ).length +
            /*
             * Unread briefings, which live on Assistant.
             *
             * WITHOUT THIS THE MARK IS USELESS. A scheduled briefing lands while
             * you are on Code or Browser — that is the entire point of scheduling
             * it — and a badge only visible once you are already looking at the
             * Assistant surface tells you nothing you did not know.
             *
             * The per-tile "new" chip and this dot read the same state, so they
             * cannot disagree about whether there is news.
             */
            (surface.id === 'assistant' ? unreadWidgets : 0);
          return (
            <button
              key={surface.id}
              onClick={() => setActiveSurface(surface.id)}
              className={`relative rounded-md px-3.5 py-1 text-sm font-medium transition-all ${
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {surface.label}
              {unreadCount > 0 && !isActive && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
              )}
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />
    </div>
  );
}
