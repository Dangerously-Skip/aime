"use client";

import { useEffect } from "react";
import { useAppStore, type Surface } from "@/stores/app-store";
import { useContextBusStore } from "@/stores/context-bus-store";
import {
  PanelLeftClose,
  PanelLeft,
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
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Tab pills — must be no-drag */}
      <div
        className="flex items-center gap-1 rounded-lg bg-muted/60 p-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {SURFACES.map((surface) => {
          const isActive = activeSurface === surface.id;
          const unreadCount = useContextBusStore((s) =>
            s.events.filter(e => !e.consumed && (e.priority === 'p0' || e.priority === 'p1') && (!e.targetSurface || e.targetSurface === surface.id)).length
          );
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
