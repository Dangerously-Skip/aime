"use client";

import { useState, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useProjectStore, type KnowledgeFile, type ProjectArtifact, type ProjectTimeline, PROJECT_ICONS } from "@/stores/project-store";
import { Trash2, Upload, FileText, X, Clock, FolderOpen, Globe, MessageSquare, Briefcase, Code2 } from "lucide-react";
import { ProjectIcon } from "@/components/shared/project-icon";

const SURFACE_OPTIONS = [
  { id: "chat", label: "Chat" },
  { id: "cowork", label: "Cowork" },
  { id: "code", label: "Code" },
];

const SURFACE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  cowork: Briefcase,
  code: Code2,
  browser: Globe,
};

function SurfaceIcon({ surface, className }: { surface: string; className?: string }) {
  const Icon = SURFACE_ICONS[surface] || MessageSquare;
  return <Icon className={className} />;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function ArtifactsBrowser({ artifacts, onRemove }: { artifacts: ProjectArtifact[]; onRemove: (id: string) => void }) {
  if (artifacts.length === 0) {
    return <p className="text-xs text-muted-foreground">No artifacts yet.</p>;
  }

  // Group by surface
  const grouped = artifacts.reduce<Record<string, ProjectArtifact[]>>((acc, a) => {
    (acc[a.surface] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([surface, items]) => (
        <div key={surface}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <SurfaceIcon surface={surface} className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium capitalize">{surface}</span>
            <span className="text-xs text-muted-foreground">({items.length})</span>
          </div>
          <div className="space-y-1 ml-5">
            {items.map((artifact) => (
              <div key={artifact.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs group">
                {artifact.type === "url" ? (
                  <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : artifact.type === "summary" ? (
                  <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <span className="truncate flex-1" title={artifact.path}>{artifact.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{formatTimeAgo(artifact.createdAt)}</span>
                <button
                  onClick={() => onRemove(artifact.id)}
                  className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineView({ timeline }: { timeline: ProjectTimeline[] }) {
  if (timeline.length === 0) {
    return <p className="text-xs text-muted-foreground">No activity yet.</p>;
  }

  const sorted = [...timeline].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);

  return (
    <div className="space-y-2">
      {sorted.map((entry) => (
        <div key={entry.id} className="flex items-start gap-2.5">
          <div className="mt-0.5">
            <SurfaceIcon surface={entry.surface} className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs">{entry.action}</p>
            <p className="text-[10px] text-muted-foreground">{formatTimeAgo(entry.timestamp)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

interface ProjectSettingsProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectSettings({ projectId, open, onOpenChange }: ProjectSettingsProps) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const updateProject = useProjectStore((s) => s.updateProject);
  const removeProject = useProjectStore((s) => s.removeProject);
  const addKnowledgeFile = useProjectStore((s) => s.addKnowledgeFile);
  const removeKnowledgeFile = useProjectStore((s) => s.removeKnowledgeFile);
  const removeArtifact = useProjectStore((s) => s.removeArtifact);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const knowledgeInputRef = useRef<HTMLInputElement>(null);

  if (!project) return null;

  function handleKnowledgeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = () => {
        const kf: KnowledgeFile = {
          id: crypto.randomUUID(),
          name: file.name,
          content: reader.result as string,
          type: file.type || "text/plain",
          size: file.size,
          addedAt: Date.now(),
        };
        const error = addKnowledgeFile(projectId, kf);
        if (error) {
          alert(error);
        }
      };
      reader.readAsText(file);
    }

    e.target.value = "";
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    removeProject(projectId);
    setConfirmDelete(false);
    onOpenChange(false);
  }

  function toggleSurface(surfaceId: string) {
    const current = project!.surfaces;
    const updated = current.includes(surfaceId)
      ? current.filter((s) => s !== surfaceId)
      : [...current, surfaceId];
    if (updated.length === 0) return;
    updateProject(projectId, { surfaces: updated });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  const totalKnowledgeSize = project.knowledgeFiles.reduce((sum, f) => sum + f.size, 0);

  return (
    <Sheet open={open} onOpenChange={(v) => { setConfirmDelete(false); onOpenChange(v); }}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Project Settings</SheetTitle>
              <SheetDescription>
                Configure project name, instructions, and knowledge files.
              </SheetDescription>
            </div>
            {/* Delete button — always visible in header */}
            <div className="shrink-0">
              {confirmDelete ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6 py-4">
          {/* Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={project.name}
              onChange={(e) => updateProject(projectId, { name: e.target.value })}
              placeholder="Project name"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={project.description}
              onChange={(e) => updateProject(projectId, { description: e.target.value })}
              placeholder="Brief description..."
            />
          </div>

          {/* Icon */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_ICONS.map((iconName) => (
                <button
                  key={iconName}
                  onClick={() => updateProject(projectId, { icon: iconName })}
                  className={`h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
                    (project.icon || "folder") === iconName
                      ? "bg-primary/10 ring-2 ring-primary ring-offset-1 ring-offset-background text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <ProjectIcon icon={iconName} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Surfaces */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Surfaces</label>
            <div className="flex gap-2">
              {SURFACE_OPTIONS.map((surface) => (
                <button
                  key={surface.id}
                  onClick={() => toggleSurface(surface.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    project.surfaces.includes(surface.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted-foreground/20"
                  }`}
                >
                  {surface.label}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Custom Instructions */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Custom Instructions</label>
            <p className="text-xs text-muted-foreground">
              These instructions will be included in every conversation within this project.
            </p>
            <Textarea
              value={project.customInstructions}
              onChange={(e) => updateProject(projectId, { customInstructions: e.target.value })}
              placeholder="e.g. Always respond in a formal tone. Focus on TypeScript best practices..."
              rows={5}
              className="resize-none text-sm"
            />
          </div>

          <Separator />

          {/* Knowledge Files */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Knowledge Files</label>
              <span className="text-[10px] text-muted-foreground">
                {formatSize(totalKnowledgeSize)} / 2MB
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Upload text files that Claude can reference in this project&apos;s conversations.
            </p>

            <input
              ref={knowledgeInputRef}
              type="file"
              multiple
              accept=".txt,.md,.csv,.json,.xml,.js,.ts,.py,.go,.rs,.rb,.java,.c,.cpp,.h,.css,.html,.yml,.yaml,.toml,.sql,.sh,.log"
              className="hidden"
              onChange={handleKnowledgeUpload}
            />

            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => knowledgeInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Files
            </Button>

            {project.knowledgeFiles.length > 0 && (
              <div className="space-y-1 mt-2">
                {project.knowledgeFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{file.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatSize(file.size)}
                    </span>
                    <button
                      onClick={() => removeKnowledgeFile(projectId, file.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Starred */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Starred</label>
              <p className="text-xs text-muted-foreground">Pin this project to the top of the list.</p>
            </div>
            <button
              onClick={() => updateProject(projectId, { starred: !project.starred })}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                project.starred
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {project.starred ? "Starred" : "Star"}
            </button>
          </div>

          {/* Working Directory */}
          {project.folder && (
            <>
              <Separator />
              <div className="space-y-2">
                <label className="text-sm font-medium">Working Directory</label>
                <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1" title={project.folder}>{project.folder}</span>
                </div>
              </div>
            </>
          )}

          {/* Surface Activity */}
          {Object.keys(project.conversationIds).length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <label className="text-sm font-medium">Surface Activity</label>
                <div className="flex gap-2">
                  {Object.entries(project.conversationIds).map(([surface, ids]) => (
                    ids.length > 0 && (
                      <div key={surface} className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs">
                        <SurfaceIcon surface={surface} className="h-3 w-3 text-muted-foreground" />
                        <span className="capitalize">{surface}</span>
                        <span className="text-muted-foreground">({ids.length})</span>
                      </div>
                    )
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Artifacts */}
          <Separator />
          <div className="space-y-2">
            <label className="text-sm font-medium">Artifacts</label>
            <p className="text-xs text-muted-foreground">
              Files and resources produced across surfaces in this project.
            </p>
            <ArtifactsBrowser
              artifacts={project.artifacts}
              onRemove={(artifactId) => removeArtifact(projectId, artifactId)}
            />
          </div>

          {/* Timeline */}
          <Separator />
          <div className="space-y-2">
            <label className="text-sm font-medium">Activity Timeline</label>
            <p className="text-xs text-muted-foreground">
              Recent activity across all surfaces.
            </p>
            <TimelineView timeline={project.timeline} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
