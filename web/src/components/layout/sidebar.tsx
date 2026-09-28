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
import { loadFeedbackWidget, openFeedback } from "./feedback";
import { Flag, FolderKanban, Heart, MessageCircle, Plus, Search, Settings, Wrench } from "lucide-react";
import { useConversationStore, type Conversation } from "@/stores/conversation-store";
import { useAssistantStore } from "@/stores/assistant-store";

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
  const setCustomizeSection = useAppStore((s) => s.setCustomizeSection);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const displayName = useSettingsStore((s) => s.displayName);
  const fullName = useSettingsStore((s) => s.fullName);
  const activityFeedOpen = useAppStore((s) => s.activityFeedOpen);
  const setActivityFeedOpen = useAppStore((s) => s.setActivityFeedOpen);
  /*
   * UNREAD CARDS, which is what this button opens.
   *
   * It counted `useHeartbeatStore` entries — a store nothing has written to
   * since `runSilentHeartbeat` was disabled. So the badge was permanently zero
   * while the panel beside it filled with unread standing-order results.
   */
  const unreadCards = useAssistantStore((s) => s.cards.filter((c) => c.unread).length);

  // Resolved at build time (NEXT_PUBLIC_*). Unset is the normal open-source case.
  const feedbackKey = process.env.NEXT_PUBLIC_FEEDLYBACKLY_API_KEY;

  // FeedlyBackly widget — loads with a hidden launcher, opened by the Flag
  // button. Their API may 500 intermittently (their side). See feedback.ts for
  // why nothing third-party loads without a key.
  useEffect(() => {
    loadFeedbackWidget(feedbackKey);
  }, [feedbackKey]);

  const handleFeedback = useCallback(() => {
    openFeedback({ apiKey: feedbackKey, name: displayName || fullName || undefined });
  }, [feedbackKey, displayName, fullName]);
  const feedbackLabel = feedbackKey ? "Send feedback" : "Report an issue on GitHub";
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
          onClick={() => {
            // Always the landing page: from inside a section this was a no-op
            // (the mode was already "customize"), so the only way back to the
            // overview was each panel's own back arrow.
            setSidebarMode("customize");
            setCustomizeSection("landing");
          }}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            sidebarMode === "customize"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
          }`}
        >
          {/* A wrench, not sparkles: Customize is where you configure skills,
              connectors and plugins, and sparkles reads as "AI magic" — the one
              thing this panel is not. */}
          <Wrench className="h-3.5 w-3.5" />
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
            title="Profile and settings"
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
            onClick={() => setActivityFeedOpen(!activityFeedOpen)}
            title="Updates"
            aria-label={unreadCards > 0 ? `Updates (${unreadCards} unread)` : "Updates"}
            aria-expanded={activityFeedOpen}
            className="relative p-1.5 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <Heart className="h-3.5 w-3.5" />
            {unreadCards > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                {unreadCards > 9 ? "9+" : unreadCards}
              </span>
            )}
          </button>
          {/* Feedback button */}
          <button
            onClick={handleFeedback}
            title={feedbackLabel}
            aria-label={feedbackLabel}
            className="p-1.5 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <Flag className="h-3.5 w-3.5" />
          </button>
          {/* Settings button */}
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
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
