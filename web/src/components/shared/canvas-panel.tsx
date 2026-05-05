"use client";

import { ChevronLeft, ChevronRight, Trash2, X, LayoutDashboard, Pin, Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { A2UIDocumentRenderer } from "@/lib/a2ui/renderer";
import type { A2UIDocument, A2UIAction } from "@/lib/a2ui/types";
import { useProjectStore } from "@/stores/project-store";

interface CanvasPanelProps {
  open: boolean;
  doc: A2UIDocument | null;
  onClose: () => void;
  onBack: () => void;
  onForward: () => void;
  onClear: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onAction?: (action: A2UIAction) => void;
  /** Surface this panel is rendered in — captured on pin for context. */
  surface?: string;
  /** Conversation that produced the canvas — captured on pin for regenerate. */
  conversationId?: string;
}

export function CanvasPanel({
  open,
  doc,
  onClose,
  onBack,
  onForward,
  onClear,
  canGoBack,
  canGoForward,
  onAction,
  surface,
  conversationId,
}: CanvasPanelProps) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const pinCanvas = useProjectStore((s) => s.pinCanvas);
  const [pinned, setPinned] = useState(false);

  if (!open) return null;

  const handlePin = () => {
    if (!doc || !activeProjectId) return;
    pinCanvas(activeProjectId, {
      id: crypto.randomUUID(),
      name: doc.title || "Untitled canvas",
      doc,
      pinnedAt: Date.now(),
      surface,
      conversationId,
    });
    setPinned(true);
    setTimeout(() => setPinned(false), 1500);
  };

  return (
    <div className="flex flex-col w-[480px] border-l border-border bg-background shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium flex-1 truncate">
          {doc?.title || "Canvas"}
        </span>

        {/* Navigation */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          disabled={!canGoBack}
          title="Previous canvas"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onForward}
          disabled={!canGoForward}
          title="Next canvas"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Pin to project — only when a project is active */}
        {activeProjectId && doc && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handlePin}
            disabled={pinned}
            title={pinned ? "Pinned" : "Pin to project"}
          >
            {pinned ? <Check className="h-4 w-4 text-success" /> : <Pin className="h-4 w-4" />}
          </Button>
        )}

        {/* Clear */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClear}
          title="Clear canvas"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        {/* Close */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          title="Close canvas panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1">
        {doc ? (
          <A2UIDocumentRenderer doc={doc} onAction={onAction} />
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <LayoutDashboard className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No canvas yet</p>
            <p className="text-xs mt-1">Ask the agent to "show a canvas with..."</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
