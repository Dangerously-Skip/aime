"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Tabbar } from "./tabbar";
import { SurfaceRouter } from "./surface-router";
import { useAppStore, type Surface } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useProjectStore } from "@/stores/project-store";
import { useElectron } from "@/hooks/use-electron";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { useSettingsStore } from "@/stores/settings-store";
import { ProjectGrid } from "@/components/projects/project-grid";
import { ProjectDetail } from "@/components/projects/project-detail";
import { ProjectSettings } from "@/components/projects/project-settings";
import { ProjectCreate } from "@/components/projects/project-create";
import { CustomizeView } from "@/components/customize/customize-view";
import { UpdateBanner } from "@/components/shared/update-banner";
import { ReminderModal } from "@/components/shared/reminder-modal";
import { HeartbeatPanel } from "./heartbeat-panel";

export function AppShell() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const setSidebarVisible = useAppStore((s) => s.setSidebarVisible);
  const sidebarMode = useAppStore((s) => s.sidebarMode);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const viewingProjectId = useAppStore((s) => s.viewingProjectId);
  const setViewingProjectId = useAppStore((s) => s.setViewingProjectId);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const activeSurface = useAppStore((s) => s.activeSurface);
  const setActiveSurface = useAppStore((s) => s.setActiveSurface);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const addConversation = useConversationStore((s) => s.addConversation);
  const conversations = useConversationStore((s) => s.conversations);
  const addProject = useProjectStore((s) => s.addProject);
  const { isElectron } = useElectron();

  const pushToTalkEnabled = useSettingsStore((s) => s.pushToTalkEnabled);
  const pushToTalkAccelerator = useSettingsStore((s) => s.pushToTalkAccelerator);

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  // The global dictation hotkey (P4.1), mounted ONCE for the whole app.
  //
  // Deliberately here and not in a surface. An OS-wide shortcut is a single
  // exclusive registration, so the component that claims it has to be one that
  // exists once — and this is it. Every surface is mounted at the same time
  // (see surface-router), so when chat and cowork each held this hook, both
  // effects ran and the inactive one released the active one's shortcut.
  // The transcript is routed to the on-screen surface's composer by
  // lib/voice/voice-session, via the VoiceScope the router provides.
  usePushToTalk({ enabled: pushToTalkEnabled, accelerator: pushToTalkAccelerator });

  // Global keyboard shortcuts: Cmd+, (settings), Cmd+N (new chat), Cmd+K (search)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        const conv = {
          id: crypto.randomUUID(),
          title: "New Chat",
          surface: activeSurface,
          lastMessage: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        addConversation(conv);
        setActiveConversation(conv.id);
        setSidebarMode("history");
      } else if (e.key === "k") {
        e.preventDefault();
        if (!sidebarVisible) setSidebarVisible(true);
        setSidebarMode("history");
        setTimeout(() => document.querySelector<HTMLInputElement>('[placeholder="Search..."]')?.focus(), 50);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSettingsOpen, activeSurface, addConversation, setActiveConversation, setSidebarMode, sidebarVisible, setSidebarVisible]);

  // Listen for "open-settings" from Electron menu (Settings… menu item)
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onOpenSettings) return;
    window.electronAPI.onOpenSettings(() => setSettingsOpen(true));
  }, [setSettingsOpen]);

  // Reset project view when switching away from projects mode
  useEffect(() => {
    if (sidebarMode !== "projects") {
      setViewingProjectId(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- view state is also set by user actions, so it can't be derived from sidebarMode during render
      setCreatingProject(false);
    }
  }, [sidebarMode, setViewingProjectId]);

  function handleNewProject() {
    setCreatingProject(true);
    setViewingProjectId(null);
  }

  function handleCreateProject(name: string, description: string, icon: string) {
    const project = {
      id: crypto.randomUUID(),
      name,
      description,
      customInstructions: "",
      knowledgeFiles: [],
      surfaces: ["chat", "cowork", "code"],
      color: `hsl(${Math.floor(Math.random() * 360)}, 60%, 50%)`,
      icon,
      starred: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      artifacts: [],
      timeline: [],
      conversationIds: {},
    };
    addProject(project);
    setCreatingProject(false);
    setViewingProjectId(project.id);
  }

  function handleOpenConversation(conversationId: string) {
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) setActiveSurface(conv.surface as Surface);
    setActiveConversation(conversationId);
    setSidebarMode("history");
    setViewingProjectId(null);
    setCreatingProject(false);
  }

  const showProjects = sidebarMode === "projects";
  const showCustomize = sidebarMode === "customize";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <div
        className={`h-full shrink-0 transition-all duration-200 ${
          sidebarVisible ? "w-[250px]" : "w-0"
        } overflow-hidden`}
      >
        <Sidebar isElectron={isElectron} onNewProject={handleNewProject} />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Tabbar (also serves as drag region) */}
        <Tabbar isElectron={isElectron} />

        {/* Surface area, Project views, or Customize view */}
        <div className="flex-1 min-h-0 relative">
          {showCustomize ? (
            <CustomizeView />
          ) : showProjects ? (
            creatingProject ? (
              <ProjectCreate
                onCancel={() => setCreatingProject(false)}
                onCreate={handleCreateProject}
              />
            ) : viewingProjectId ? (
              <ProjectDetail
                projectId={viewingProjectId}
                onBack={() => setViewingProjectId(null)}
                onOpenSettings={(id) => setEditingProjectId(id)}
                onOpenConversation={handleOpenConversation}
              />
            ) : (
              <ProjectGrid
                onSelectProject={(id) => setViewingProjectId(id)}
                onNewProject={handleNewProject}
              />
            )
          ) : (
            <SurfaceRouter />
          )}
        </div>
      </div>

      <UpdateBanner />
      <ReminderModal />
      <HeartbeatPanel />

      {editingProjectId && (
        <ProjectSettings
          projectId={editingProjectId}
          open={!!editingProjectId}
          onOpenChange={(open) => {
            if (!open) setEditingProjectId(null);
          }}
        />
      )}
    </div>
  );
}
