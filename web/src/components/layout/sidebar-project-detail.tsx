"use client";

import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ProjectIcon } from "@/components/shared/project-icon";
import { SidebarChats } from "./sidebar-chats";

interface SidebarProjectDetailProps {
  projectId: string;
  onBack: () => void;
}

export function SidebarProjectDetail({
  projectId,
  onBack,
}: SidebarProjectDetailProps) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-xs text-muted-foreground">
        Project not found
        <Button variant="ghost" size="sm" onClick={onBack} className="mt-2">
          Go back
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Project header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sidebar-border">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <ProjectIcon icon={project.icon} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold truncate flex-1">
          {project.name}
        </span>
      </div>

      {/* Description */}
      {project.description && (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-b border-sidebar-border">
          {project.description}
        </div>
      )}

      {/* Project conversations */}
      <SidebarChats projectId={projectId} />
    </>
  );
}
