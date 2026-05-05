"use client";

import { useState } from "react";
import { LayoutDashboard, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectStore, type PinnedCanvas } from "@/stores/project-store";
import { useCanvasStore } from "@/stores/canvas-store";
import { A2UIDocumentRenderer } from "@/lib/a2ui/renderer";

interface ProjectCanvasesProps {
  projectId: string;
}

export function ProjectCanvases({ projectId }: ProjectCanvasesProps) {
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const unpinCanvas = useProjectStore((s) => s.unpinCanvas);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setOpen = useCanvasStore((s) => s.setOpen);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const canvases = project?.pinnedCanvases ?? [];
  if (canvases.length === 0) return null;

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openInPanel = (canvas: PinnedCanvas) => {
    pushCanvas(canvas.doc);
    if (canvas.surface) setOpen(canvas.surface, true);
  };

  return (
    <div className="mt-8">
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
            Canvases
            <span className="text-xs font-normal text-muted-foreground">({canvases.length})</span>
          </h3>
        </div>

        <div className="divide-y divide-border">
          {canvases.map((canvas) => {
            const isExpanded = expanded.has(canvas.id);
            return (
              <div key={canvas.id}>
                <div className="flex items-center gap-2 px-5 py-3 hover:bg-muted/30 transition-colors">
                  <button
                    onClick={() => toggleExpand(canvas.id)}
                    className="text-muted-foreground hover:text-foreground"
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => openInPanel(canvas)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="text-sm font-medium text-foreground truncate">{canvas.name}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                      Pinned {new Date(canvas.pinnedAt).toLocaleDateString()}
                      {canvas.surface ? ` · from ${canvas.surface}` : ""}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => unpinCanvas(projectId, canvas.id)}
                    title="Unpin"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {isExpanded && (
                  <div className="bg-muted/20 border-t border-border">
                    <A2UIDocumentRenderer doc={canvas.doc} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
