"use client";

import { useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { SidebarChats } from "./sidebar-chats";
import { SidebarProjects } from "./sidebar-projects";
import { SidebarProjectDetail } from "./sidebar-project-detail";
import { Settings } from "lucide-react";

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

  return (
    <div className="flex h-full w-[250px] flex-col bg-sidebar border-r border-sidebar-border">
      {/* Header — with traffic light padding in Electron */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{
          paddingTop: isElectron ? "2rem" : undefined,
          WebkitAppRegion: isElectron ? "drag" : undefined,
        } as React.CSSProperties}
      >
        {/* Mode switcher */}
        <div
          className="flex items-center bg-sidebar-accent/50 rounded-lg p-0.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            onClick={() => {
              setSidebarMode("history");
              setSelectedProjectId(null);
            }}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              sidebarMode === "history"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Chats
          </button>
          <button
            onClick={() => setSidebarMode("projects")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              sidebarMode === "projects"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Projects
          </button>
        </div>
      </div>

      {/* Content based on mode */}
      {sidebarMode === "history" ? (
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

      {/* Footer — user avatar + settings */}
      <div className="border-t border-sidebar-border">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
        >
          <Avatar size="sm">
            <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
              {getInitials(displayName, fullName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate flex-1 text-left font-medium">
            {displayName || fullName || "Settings"}
          </span>
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
