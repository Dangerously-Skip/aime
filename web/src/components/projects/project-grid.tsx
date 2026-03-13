"use client";

import { useState } from "react";
import { useProjectStore, type Project } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { ProjectIcon } from "@/components/shared/project-icon";

type SortOption = "activity" | "name" | "created";

interface ProjectGridProps {
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days}d ago`;
  const months = Math.floor(days / 30);
  return `Updated ${months} month${months > 1 ? "s" : ""} ago`;
}

function sortProjects(projects: Project[], sort: SortOption): Project[] {
  const sorted = [...projects];
  switch (sort) {
    case "activity":
      return sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "created":
      return sorted.sort((a, b) => b.createdAt - a.createdAt);
    default:
      return sorted;
  }
}

export function ProjectGrid({ onSelectProject, onNewProject }: ProjectGridProps) {
  const projects = useProjectStore((s) => s.projects);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("activity");

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sorted = sortProjects(filtered, sort);

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="w-full max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-light text-foreground tracking-tight">Projects</h1>
          <Button
            variant="outline"
            onClick={onNewProject}
            className="gap-2 rounded-full"
          >
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 pl-11 text-sm rounded-xl bg-muted/50 border-border"
          />
        </div>

        {/* Sort */}
        <div className="flex items-center justify-end gap-2 mb-6">
          <span className="text-sm text-muted-foreground">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="text-sm font-medium bg-transparent border border-border rounded-lg px-3 py-1.5 text-foreground cursor-pointer outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="activity">Activity</option>
            <option value="name">Name</option>
            <option value="created">Created</option>
          </select>
        </div>

        {/* Project cards — 2-column grid like Claude.ai */}
        {sorted.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sorted.map((project) => (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className="flex flex-col items-start rounded-xl border border-border bg-card p-5 text-left transition-colors hover:bg-muted/50 min-h-[160px]"
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <ProjectIcon icon={project.icon} className="h-5 w-5 text-muted-foreground" />
                  <h3 className="text-base font-medium text-foreground">
                    {project.name}
                  </h3>
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-auto">
                    {project.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-4">
                  {formatTimeAgo(project.updatedAt)}
                </p>
              </button>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <h3 className="text-lg font-medium text-foreground mb-2">No projects yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create a project to organize your conversations with custom instructions and knowledge files.
            </p>
            <Button onClick={onNewProject} className="gap-2 rounded-full">
              <Plus className="h-4 w-4" />
              New project
            </Button>
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground">
              No projects match &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
