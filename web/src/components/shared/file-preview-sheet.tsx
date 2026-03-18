"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText, GripVertical, Loader2, X } from "lucide-react";
import { getRenderer, UNPRINTABLE_BINARY_EXTS } from "./file-renderers";

interface FileData {
  name: string;
  path: string;
  size: number;
  ext: string;
  content: string;
  encoding: "utf-8" | "base64";
}

interface FilePreviewSheetProps {
  path: string | null;
  open: boolean;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortenPath(path: string): string {
  const parts = path.split("/");
  if (parts.length <= 4) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function openExternally(path: string) {
  if ((window as unknown as { electronAPI?: { openPath?: (p: string) => void } }).electronAPI?.openPath) {
    (window as unknown as { electronAPI: { openPath: (p: string) => void } }).electronAPI.openPath(path);
  }
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 1200;
const DEFAULT_WIDTH = 600;

export function FilePreviewSheet({ path, open, onClose }: FilePreviewSheetProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const resizingRef = useRef(false);

  useEffect(() => {
    if (!open || !path) {
      setFileData(null);
      setError(null);
      return;
    }

    const pathExt = `.${path.split(".").pop()?.toLowerCase() || ""}`;

    // Only skip reading for truly un-renderable binary formats
    if (UNPRINTABLE_BINARY_EXTS.has(pathExt)) {
      setFileData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const api = (window as unknown as { electronAPI?: { readFile?: (p: string) => Promise<FileData> } }).electronAPI;
    if (!api?.readFile) {
      setError("File preview is only available in the desktop app.");
      setLoading(false);
      return;
    }

    api.readFile(path)
      .then((data) => {
        if (!cancelled) setFileData(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "Failed to read file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, path]);

  // Drag-resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newWidth = window.innerWidth - ev.clientX;
      setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)));
    };
    const handleMouseUp = () => {
      resizingRef.current = false;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  const ext = fileData?.ext || (path ? `.${path.split(".").pop()?.toLowerCase()}` : "");
  const isUnprintable = UNPRINTABLE_BINARY_EXTS.has(ext);
  const Renderer = getRenderer(ext);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="overflow-hidden flex flex-col p-0"
        style={{ width, maxWidth: MAX_WIDTH }}
      >
        {/* Drag-resize handle on left edge */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute inset-y-0 left-0 w-1.5 cursor-col-resize bg-transparent hover:bg-primary/30 transition-colors z-10 flex items-center justify-center"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground/0 hover:text-muted-foreground transition-colors" />
        </div>

        <SheetHeader className="shrink-0 pl-5 pr-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <SheetTitle className="truncate text-sm flex-1">
              {fileData?.name || path?.split("/").pop() || "File Preview"}
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <SheetDescription className="flex items-center gap-2 flex-wrap">
            {fileData && (
              <>
                <Badge variant="outline" className="text-[10px]">
                  {fileData.ext || "file"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatSize(fileData.size)}
                </span>
                <span className="text-xs text-muted-foreground truncate" title={fileData.path}>
                  {shortenPath(fileData.path)}
                </span>
              </>
            )}
            {path && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs ml-auto"
                onClick={() => openExternally(path)}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Open
              </Button>
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-auto min-h-0 px-5 pb-4">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
              <p className="text-sm text-muted-foreground">{error}</p>
              {path && (
                <Button variant="outline" size="sm" onClick={() => openExternally(path)}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Open in default app
                </Button>
              )}
            </div>
          )}

          {/* Unprintable binary — can't preview, offer to open externally */}
          {isUnprintable && !fileData && !loading && !error && path && (
            <Renderer
              content=""
              encoding="utf-8"
              ext={ext}
              name={path.split("/").pop() || ""}
              path={path}
              onOpenExternal={openExternally}
            />
          )}

          {/* Render file content via the appropriate renderer */}
          {fileData && !loading && !error && (
            <Renderer
              content={fileData.content}
              encoding={fileData.encoding}
              ext={fileData.ext}
              name={fileData.name}
              path={fileData.path}
              onOpenExternal={openExternally}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
