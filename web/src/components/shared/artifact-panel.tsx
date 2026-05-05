"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  Check,
  FileText,
  Code2,
  Globe,
  FileType,
  Download,
  Loader2,
  ExternalLink,
  Eye,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";
import type { ParsedArtifact } from "@/lib/artifacts/parser";
import { wrapInHtmlDoc } from "@/lib/artifacts/preview";
import {
  saveArtifactAs,
  autoSaveArtifact,
  type SaveStatus,
} from "@/lib/artifacts/persistence";

interface ArtifactPanelProps {
  artifact: ParsedArtifact | null;
  open: boolean;
  onClose: () => void;
  projectFolder?: string | null;
  conversationId?: string;
  projectId?: string | null;
  onArtifactSaved?: (artifactId: string, filePath: string) => void;
}

const TYPE_ICON: Record<ParsedArtifact["type"], typeof FileText> = {
  markdown: FileText,
  code: Code2,
  html: Globe,
  text: FileType,
};

export function ArtifactPanel({
  artifact,
  open,
  onClose,
  projectFolder,
  conversationId,
  projectId,
  onArtifactSaved,
}: ArtifactPanelProps) {
  const [copied, setCopied] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: "idle" });
  const [htmlTab, setHtmlTab] = useState<"preview" | "code">("preview");
  const [expanded, setExpanded] = useState(false);
  const [customWidth, setCustomWidth] = useState<number | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    // Capture current pixel width so drag deltas land on the right baseline.
    const sheet = (e.currentTarget as HTMLElement).parentElement;
    const startWidth = sheet?.getBoundingClientRect().width ?? 640;
    const onMove = (ev: MouseEvent) => {
      // Dragging left grows the panel because it's anchored to the right edge.
      const next = Math.min(window.innerWidth - 80, Math.max(360, startWidth + (startX - ev.clientX)));
      setCustomWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
  const autoSavedRef = useRef<string | null>(null);

  // Auto-save when panel opens with a project folder
  useEffect(() => {
    if (!open || !artifact || !projectFolder || !conversationId) return;
    // Skip if already auto-saved this artifact
    if (autoSavedRef.current === artifact.id) return;

    let cancelled = false;
    autoSavedRef.current = artifact.id;

    (async () => {
      setSaveStatus({ state: "saving" });
      try {
        const path = await autoSaveArtifact(artifact, projectFolder, conversationId);
        if (cancelled) return;
        if (path) {
          setSaveStatus({ state: "saved", path });
          if (onArtifactSaved && projectId) {
            onArtifactSaved(artifact.id, path);
          }
        } else {
          // Not in Electron — silently reset
          setSaveStatus({ state: "idle" });
        }
      } catch (err) {
        if (cancelled) return;
        setSaveStatus({
          state: "error",
          message: err instanceof Error ? err.message : "Auto-save failed",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, artifact?.id, projectFolder, conversationId, projectId, onArtifactSaved]);

  // Reset state when artifact changes
  useEffect(() => {
    if (!open) {
      setSaveStatus({ state: "idle" });
      autoSavedRef.current = null;
    }
  }, [open]);

  function handleCopy() {
    if (!artifact) return;
    navigator.clipboard.writeText(artifact.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const handleSaveAs = useCallback(async () => {
    if (!artifact) return;
    setSaveStatus({ state: "saving" });
    try {
      const path = await saveArtifactAs(artifact);
      if (path) {
        setSaveStatus({ state: "saved", path });
        if (onArtifactSaved && projectId) {
          onArtifactSaved(artifact.id, path);
        }
      } else {
        setSaveStatus({ state: "idle" });
      }
    } catch (err) {
      setSaveStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }, [artifact, onArtifactSaved, projectId]);

  function handleOpenPath() {
    if (saveStatus.state !== "saved") return;
    if (typeof window !== "undefined" && window.electronAPI) {
      // Open the containing folder
      const dir = saveStatus.path.split("/").slice(0, -1).join("/");
      window.electronAPI.openPath(dir);
    }
  }

  const Icon = artifact ? TYPE_ICON[artifact.type] : FileText;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className={`overflow-hidden flex flex-col transition-[max-width,width] duration-200 ${
          expanded
            ? "!w-screen !max-w-none"
            : "w-full sm:max-w-xl md:max-w-2xl"
        }`}
        style={!expanded && customWidth ? { width: `${customWidth}px`, maxWidth: 'none' } : undefined}
      >
        {/* Resize handle — drag to widen */}
        {!expanded && (
          <div
            onMouseDown={handleResizeStart}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-primary/30 transition-colors z-10"
            title="Drag to resize"
          />
        )}
        <SheetHeader className="shrink-0">
          <div className="flex items-center gap-2 pr-8">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <SheetTitle className="truncate text-sm">
              {artifact?.title || "Artifact"}
            </SheetTitle>
          </div>
          <SheetDescription className="flex items-center gap-2">
            {artifact && (
              <>
                <Badge variant="outline" className="text-[10px]">
                  {artifact.language || artifact.type}
                </Badge>
                <div className="flex items-center gap-1 ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setExpanded((v) => !v)}
                    title={expanded ? "Collapse panel" : "Expand panel"}
                  >
                    {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleSaveAs}
                    disabled={saveStatus.state === "saving"}
                  >
                    <Download className="h-3 w-3 mr-1" />
                    Save as...
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 mr-1 text-success" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 mr-1" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto min-h-0 mt-2">
          {artifact && artifact.type === "markdown" && (
            <div className="prose prose-sm dark:prose-invert max-w-none px-1">
              <MarkdownRenderer content={artifact.content} />
            </div>
          )}

          {artifact && artifact.type === "code" && (
            <pre className="rounded-lg bg-muted/40 p-4 text-xs leading-relaxed overflow-x-auto font-mono whitespace-pre-wrap break-words">
              <code
                className={
                  artifact.language ? `language-${artifact.language}` : ""
                }
              >
                {artifact.content}
              </code>
            </pre>
          )}

          {artifact && artifact.type === "html" && (
            <div className="flex flex-col h-full">
              {/* Code / Preview tab bar */}
              <div className="flex items-center gap-1 mb-2 px-1">
                <button
                  type="button"
                  onClick={() => setHtmlTab("preview")}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    htmlTab === "preview"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Eye className="h-3 w-3" />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setHtmlTab("code")}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    htmlTab === "code"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Code2 className="h-3 w-3" />
                  Code
                </button>
              </div>

              {htmlTab === "preview" ? (
                <iframe
                  srcDoc={wrapInHtmlDoc(artifact.content)}
                  sandbox="allow-scripts"
                  className="w-full flex-1 min-h-[300px] border border-border rounded-lg bg-white"
                  title={artifact.title}
                />
              ) : (
                <pre className="rounded-lg bg-muted/40 p-4 text-xs leading-relaxed overflow-x-auto font-mono whitespace-pre-wrap break-words">
                  <code className="language-html">{artifact.content}</code>
                </pre>
              )}
            </div>
          )}

          {artifact && artifact.type === "text" && (
            <pre className="rounded-lg bg-muted/40 p-4 text-sm leading-relaxed overflow-x-auto whitespace-pre-wrap break-words">
              {artifact.content}
            </pre>
          )}
        </div>

        {/* Save status bar */}
        {saveStatus.state !== "idle" && (
          <div className="shrink-0 border-t border-border px-4 py-2 text-xs flex items-center gap-2">
            {saveStatus.state === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Saving...</span>
              </>
            )}
            {saveStatus.state === "saved" && (
              <>
                <Check className="h-3 w-3 text-green-500" />
                <span className="text-muted-foreground truncate flex-1">
                  Saved to .../{saveStatus.path.split("/").slice(-2).join("/")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px]"
                  onClick={handleOpenPath}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </>
            )}
            {saveStatus.state === "error" && (
              <span className="text-destructive">{saveStatus.message}</span>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
