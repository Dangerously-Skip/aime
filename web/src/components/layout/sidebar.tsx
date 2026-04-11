"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { SidebarChats } from "./sidebar-chats";
import { SidebarProjects } from "./sidebar-projects";
import { SidebarProjectDetail } from "./sidebar-project-detail";
import { SidebarCustomize } from "./sidebar-customize";
import {
  Settings,
  Plus,
  Search,
  Sparkles,
  MessageCircle,
  FolderKanban,
  Flag,
  Heart,
} from "lucide-react";

// FeedlyBackly widget globals
declare global {
  interface Window {
    feedlybacklySettings?: {
      apiKey: string;
      apiUrl: string;
      hideLauncher?: boolean;
      guestEnabled: boolean;
    };
    FeedlyBackly?: {
      open: () => void;
      close: () => void;
      setUser: (user: { email?: string; name?: string }) => void;
      setCustomData: (data: Record<string, unknown>) => void;
    };
  }
}
import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useHeartbeatStore } from "@/stores/heartbeat-store";

function getInitials(displayName: string, fullName: string): string {
  const name = displayName || fullName;
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface SidebarProps {
  isElectron?: boolean;
  onNewProject: () => void;
}

export function Sidebar({ isElectron = false, onNewProject }: SidebarProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const sidebarMode = useAppStore((s) => s.sidebarMode);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const displayName = useSettingsStore((s) => s.displayName);
  const fullName = useSettingsStore((s) => s.fullName);
  const heartbeatPanelOpen = useAppStore((s) => s.heartbeatPanelOpen);
  const setHeartbeatPanelOpen = useAppStore((s) => s.setHeartbeatPanelOpen);
  const heartbeatUnreadCount = useHeartbeatStore((s) => s.entries.filter((e) => e.unread).length);

  // FeedlyBackly widget — loads with hidden launcher, triggered via sidebar Flag button.
  // Note: their API may return 500s intermittently (server-side issue on their end).
  useEffect(() => {
    if (document.getElementById('feedlybackly-script')) return;
    window.feedlybacklySettings = {
      apiKey: 'REDACTED-FEEDBACK-KEY',
      apiUrl: 'https://feedlybackly-api.apps.dangerouslyskip.com',
      hideLauncher: true,
      guestEnabled: true,
    };
    const script = document.createElement('script');
    script.id = 'feedlybackly-script';
    script.src = 'https://feedlybackly-widget.apps.dangerouslyskip.com/widget.js';
    document.body.appendChild(script);
  }, []);

  const openFeedback = useCallback(() => {
    const name = displayName || fullName || undefined;
    if (window.FeedlyBackly) {
      if (name) window.FeedlyBackly.setUser({ name });
      window.FeedlyBackly.open();
    }
  }, [displayName, fullName]);
  const activeSurface = useAppStore((s) => s.activeSurface);
  const addConversation = useConversationStore((s) => s.addConversation);
  const navigateTo = useConversationStore((s) => s.navigateTo);

  function handleNewChat() {
    const conv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      surface: activeSurface,
      lastMessage: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addConversation(conv);
    navigateTo(conv.id);
    if (sidebarMode !== "history") {
      setSidebarMode("history");
    }
  }

  return (
    <div className="flex h-full w-[250px] flex-col bg-sidebar border-r border-sidebar-border">
      {/* Header — with traffic light padding in Electron */}
      <div
        className="px-3 pt-2.5 pb-1 space-y-1"
        style={{
          paddingTop: isElectron ? "2rem" : undefined,
          WebkitAppRegion: isElectron ? "drag" : undefined,
        } as React.CSSProperties}
      >
        {/* New Chat button */}
        <button
          onClick={handleNewChat}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">New chat</span>
          <kbd className="text-[10px] text-muted-foreground/60 font-normal">⌘N</kbd>
        </button>

        {/* Search */}
        <button
          onClick={() => { setSidebarMode("history"); setTimeout(() => document.querySelector<HTMLInputElement>('[placeholder="Search..."]')?.focus(), 50); }}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[10px] text-muted-foreground/60 font-normal">⌘K</kbd>
        </button>
      </div>

      {/* Navigation items */}
      <div
        className="px-3 py-1 space-y-0.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          onClick={() => setSidebarMode("customize")}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            sidebarMode === "customize"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Customize</span>
        </button>

        <button
          onClick={() => {
            setSidebarMode("history");
            setSelectedProjectId(null);
          }}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            sidebarMode === "history"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          <span>Chats</span>
        </button>

        <button
          onClick={() => setSidebarMode("projects")}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            sidebarMode === "projects"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          <FolderKanban className="h-3.5 w-3.5" />
          <span>Projects</span>
        </button>
      </div>

      {/* Divider */}
      <div className="mx-3 my-1 border-t border-sidebar-border" />

      {/* Content based on mode */}
      <div className="flex-1 min-h-0 flex flex-col">
        {sidebarMode === "customize" ? (
          <SidebarCustomize />
        ) : sidebarMode === "history" ? (
          <SidebarChats />
        ) : selectedProjectId ? (
          <SidebarProjectDetail
            projectId={selectedProjectId}
            onBack={() => setSelectedProjectId(null)}
          />
        ) : (
          <SidebarProjects
            onSelectProject={(id) => setSelectedProjectId(id)}
            onNewProject={onNewProject}
          />
        )}
      </div>

      {/* Footer — user avatar + feedback + settings */}
      <div className="border-t border-sidebar-border">
        <div className="flex items-center px-3 py-2.5 gap-1">
          {/* Avatar + name — opens settings */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors rounded-md px-1 py-1 flex-1 min-w-0"
          >
            <Avatar size="sm">
              <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                {getInitials(displayName, fullName)}
              </AvatarFallback>
            </Avatar>
            <span className="truncate flex-1 text-left font-medium">
              {displayName || fullName || "Settings"}
            </span>
          </button>
          {/* Updates / heartbeat button */}
          <button
            onClick={() => setHeartbeatPanelOpen(!heartbeatPanelOpen)}
            title="Updates"
            className="relative p-1.5 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <Heart className="h-3.5 w-3.5" />
            {heartbeatUnreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                {heartbeatUnreadCount > 9 ? "9+" : heartbeatUnreadCount}
              </span>
            )}
          </button>
          {/* Feedback button */}
          <button
            onClick={openFeedback}
            title="Send feedback"
            className="p-1.5 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <Flag className="h-3.5 w-3.5" />
          </button>
          {/* Settings button */}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="p-1.5 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
