"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, FileText, Loader2 } from "lucide-react";

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

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

const EXT_TO_LANG: Record<string, string> = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".xml": "xml",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".sql": "sql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".dockerfile": "dockerfile",
  ".graphql": "graphql",
  ".swift": "swift",
  ".kt": "kotlin",
};

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

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

export function FilePreviewSheet({ path, open, onClose }: FilePreviewSheetProps) {
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !path) {
      setFileData(null);
      setError(null);
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

  const isImage = fileData && IMAGE_EXTS.has(fileData.ext);
  const isPdf = fileData?.ext === ".pdf";
  const lang = fileData ? EXT_TO_LANG[fileData.ext] : null;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl overflow-hidden flex flex-col"
      >
        <SheetHeader className="shrink-0">
          <div className="flex items-center gap-2 pr-8">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <SheetTitle className="truncate text-sm">
              {fileData?.name || path?.split("/").pop() || "File Preview"}
            </SheetTitle>
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
        <div className="flex-1 overflow-auto min-h-0 mt-2">
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

          {fileData && !loading && !error && (
            <>
              {/* Image preview */}
              {isImage && (
                <div className="flex items-center justify-center p-4">
                  <img
                    src={
                      fileData.encoding === "base64"
                        ? `data:${EXT_TO_MIME[fileData.ext] || "image/png"};base64,${fileData.content}`
                        : fileData.ext === ".svg"
                          ? `data:image/svg+xml;utf8,${encodeURIComponent(fileData.content)}`
                          : fileData.content
                    }
                    alt={fileData.name}
                    className="max-w-full max-h-[60vh] object-contain rounded-lg border border-border"
                  />
                </div>
              )}

              {/* PDF preview */}
              {isPdf && (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <p className="text-sm text-muted-foreground">PDF preview</p>
                  <Button variant="outline" size="sm" onClick={() => openExternally(fileData.path)}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open in default app
                  </Button>
                </div>
              )}

              {/* Text/code preview */}
              {!isImage && !isPdf && (
                <pre className="rounded-lg bg-muted/40 p-4 text-xs leading-relaxed overflow-x-auto font-mono whitespace-pre-wrap break-words">
                  <code className={lang ? `language-${lang}` : ""}>
                    {fileData.content}
                  </code>
                </pre>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
