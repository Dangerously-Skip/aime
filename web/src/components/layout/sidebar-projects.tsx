"use client";

import { useProjectStore, type Project } from "@/stores/project-store";
import { useConversationStore } from "@/stores/conversation-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, FolderKanban, Star, Trash2 } from "lucide-react";
import { ProjectIcon } from "@/components/shared/project-icon";

interface SidebarProjectsProps {
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
}

export function SidebarProjects({ onSelectProject, onNewProject }: SidebarProjectsProps) {
  const projects = useProjectStore((s) => s.projects);
  const removeProject = useProjectStore((s) => s.removeProject);
  const conversations = useConversationStore((s) => s.conversations);

  function getConversationCount(projectId: string): number {
    return conversations.filter((c) => c.projectId === projectId).length;
  }

  function getLastUpdated(project: Project): string {
    const diff = Date.now() - project.updatedAt;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const starred = projects.filter((p) => p.starred);
  const unstarred = projects.filter((p) => !p.starred);

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-medium text-muted-foreground">Projects</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-sidebar-foreground hover:text-foreground"
          onClick={onNewProject}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {projects.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              <FolderKanban className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              No projects yet.
              <br />
              Create one to organize your chats.
            </div>
          )}

          {starred.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Starred
              </div>
              {starred.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  conversationCount={getConversationCount(project.id)}
                  lastUpdated={getLastUpdated(project)}
                  onClick={() => onSelectProject(project.id)}
                  onDelete={() => removeProject(project.id)}
                />
              ))}
            </>
          )}

          {unstarred.length > 0 && starred.length > 0 && (
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              All Projects
            </div>
          )}

          {unstarred.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              conversationCount={getConversationCount(project.id)}
              lastUpdated={getLastUpdated(project)}
              onClick={() => onSelectProject(project.id)}
              onDelete={() => removeProject(project.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </>
  );
}

function useProjectRoi(projectId: string) {
  const conversations = useConversationStore((s) => s.conversations);
  const projConvs = conversations.filter((c) => c.projectId === projectId && c.roi);
  if (projConvs.length === 0) return null;
  const totalHoursSaved = projConvs.reduce((s, c) => s + (c.effortEstimate?.hours ?? 0), 0);
  const totalDollarsSaved = projConvs.reduce((s, c) => s + (c.roi?.dollarsSaved ?? 0), 0);
  const avgMultiplier = projConvs.reduce((s, c) => s + (c.roi?.multiplier ?? 0), 0) / projConvs.length;
  return { totalHoursSaved, totalDollarsSaved, avgMultiplier };
}

function ProjectCard({
  project,
  conversationCount,
  lastUpdated,
  onClick,
  onDelete,
}: {
  project: Project;
  conversationCount: number;
  lastUpdated: string;
  onClick: () => void;
  onDelete: () => void;
}) {
  const roi = useProjectRoi(project.id);
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-xs transition-colors text-sidebar-foreground hover:bg-sidebar-accent/50"
    >
      <ProjectIcon icon={project.icon} className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="truncate font-medium">{project.name}</span>
          {project.starred && (
            <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
          <span>{conversationCount} chats</span>
          <span>&middot;</span>
          <span>{lastUpdated}</span>
        </div>
        {roi && (
          <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
            ~{roi.totalHoursSaved.toFixed(0)}h saved · ${Math.max(0, roi.totalDollarsSaved).toFixed(0)} · {roi.avgMultiplier.toFixed(1)}× avg
          </div>
        )}
      </div>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            onDelete();
          }
        }}
        className="hidden group-hover:block shrink-0 mt-0.5"
      >
        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
      </span>
    </button>
  );
}
