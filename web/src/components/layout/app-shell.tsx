"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "./sidebar";
import { Tabbar } from "./tabbar";
import { SurfaceRouter } from "./surface-router";
import { useAppStore } from "@/stores/app-store";
import { useConversationStore } from "@/stores/conversation-store";
import { useProjectStore } from "@/stores/project-store";
import { getRandomIcon } from "@/stores/project-store";
import { useElectron } from "@/hooks/use-electron";
import { ProjectGrid } from "@/components/projects/project-grid";
import { ProjectDetail } from "@/components/projects/project-detail";
import { ProjectSettings } from "@/components/projects/project-settings";
import { ProjectCreate } from "@/components/projects/project-create";

export function AppShell() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const sidebarMode = useAppStore((s) => s.sidebarMode);
  const setSidebarMode = useAppStore((s) => s.setSidebarMode);
  const viewingProjectId = useAppStore((s) => s.viewingProjectId);
  const setViewingProjectId = useAppStore((s) => s.setViewingProjectId);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation);
  const addProject = useProjectStore((s) => s.addProject);
  const { isElectron } = useElectron();

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);

  // Cmd+, keyboard shortcut to open settings
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSettingsOpen]);

  // Reset project view when switching away from projects mode
  useEffect(() => {
    if (sidebarMode !== "projects") {
      setViewingProjectId(null);
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
    };
    addProject(project);
    setCreatingProject(false);
    setViewingProjectId(project.id);
  }

  function handleOpenConversation(conversationId: string) {
    setActiveConversation(conversationId);
    setSidebarMode("history");
    setViewingProjectId(null);
    setCreatingProject(false);
  }

  const showProjects = sidebarMode === "projects";

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

        {/* Surface area or Project views */}
        <div className="flex-1 min-h-0 relative">
          {showProjects ? (
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
