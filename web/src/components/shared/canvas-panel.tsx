"use client";

import { ChevronLeft, ChevronRight, Trash2, X, LayoutDashboard, Pin, Check, Maximize2, Minimize2 } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
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
  const [expanded, setExpanded] = useState(false);
  const [customWidth, setCustomWidth] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Clamp customWidth + auto-expand on narrow viewports.
  // Below MIN_SIDE_BY_SIDE the side-by-side layout doesn't fit, so we flip
  // into expanded (full-viewport) mode automatically.
  const MIN_SIDE_BY_SIDE = 900;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      const w = window.innerWidth;
      if (w < MIN_SIDE_BY_SIDE) {
        setExpanded(true);
        return;
      }
      const flexParent = panelRef.current?.parentElement;
      const parentWidth = flexParent?.getBoundingClientRect().width;
      if (!parentWidth) return;
      const max = Math.max(360, parentWidth - 360);
      setCustomWidth((prev) => {
        if (prev == null) return prev;
        if (prev > max) return max;
        return prev;
      });
    };
    onResize(); // run once on mount
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const panel = (e.currentTarget as HTMLElement).parentElement;
    const startWidth = panel?.getBoundingClientRect().width ?? 480;
    // Cap based on the FLEX parent's width, not the viewport — otherwise the
    // canvas can grow past the sidebar/chat columns and crush the layout.
    const flexParent = panel?.parentElement;
    const parentWidth = flexParent?.getBoundingClientRect().width ?? window.innerWidth;
    // Always leave at least 360px for the chat column.
    const maxWidth = Math.max(480, parentWidth - 360);
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(maxWidth, Math.max(360, startWidth + (startX - ev.clientX)));
      setCustomWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Don't render at all when there's no doc — the panel was open from a
  // previous conversation but has nothing to show. Avoids janky empty chrome.
  if (!open || !doc) return null;

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
    <div
      ref={panelRef}
      className={
        expanded
          ? "fixed inset-x-0 bottom-0 top-7 z-50 flex flex-col bg-background"
          : "absolute top-0 right-0 bottom-0 z-30 flex flex-col border-l border-border bg-background shadow-xl"
      }
      style={
        !expanded
          ? {
              // Default 720px so kanban-style canvases (~3 columns × 200px) fit
              // without horizontal scroll. User can drag-resize wider/narrower.
              width: customWidth ? `${customWidth}px` : "720px",
              minWidth: "360px",
              // Hard cap so the panel can never crush sibling columns, even if
              // customWidth was somehow set too high.
              maxWidth: "calc(100% - 360px)",
            }
          : undefined
      }
    >
      {/* Resize handle */}
      {!expanded && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/30 transition-colors z-10"
          title="Drag to resize"
        />
      )}
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

        {/* Expand / collapse */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Collapse panel" : "Expand panel"}
        >
          {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>

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
