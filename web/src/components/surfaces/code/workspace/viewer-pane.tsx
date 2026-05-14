"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, AlertTriangle, GitCompare } from "lucide-react";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { readFile } from "@/lib/code-workspace/ipc";
import { getRenderer, UNPRINTABLE_BINARY_EXTS } from "@/components/shared/file-renderers";
import { Button } from "@/components/ui/button";
import { getExt, MAX_AUTO_LOAD_BYTES } from "@/lib/code-workspace/fs-tree";

interface ViewerPaneProps {
  workspace: string | null;
}

interface FileLoadState {
  loading: boolean;
  error: string | null;
  content: string;
  encoding: "utf-8" | "base64";
  binary: boolean;
  size: number;
  needsConfirm: boolean;
}

const EMPTY_LOAD: FileLoadState = {
  loading: false,
  error: null,
  content: "",
  encoding: "utf-8",
  binary: false,
  size: 0,
  needsConfirm: false,
};

/**
 * Renders the active tab. Files go through the shared file-renderers/
 * pipeline by extension; diff tabs are stubbed (Phase 2 / Agent B owns
 * diff rendering).
 */
export function ViewerPane({ workspace }: ViewerPaneProps) {
  const { activeTab } = useCodeWorkspace(workspace);
  const [load, setLoad] = useState<FileLoadState>(EMPTY_LOAD);

  const openExternal = (p: string) => {
    if (typeof window !== "undefined" && window.electronAPI?.openPath) {
      void window.electronAPI.openPath(p);
    }
  };
  const [overrideLarge, setOverrideLarge] = useState(false);

  const path = activeTab?.kind === "file" ? activeTab.path : null;
  const ext = useMemo(() => (path ? getExt(path) : ""), [path]);
  const name = useMemo(() => {
    if (!path) return "";
    const segs = path.split(/[\\/]/);
    return segs[segs.length - 1] || path;
  }, [path]);

  // Reset override + state when the active file changes.
  useEffect(() => {
    setOverrideLarge(false);
    setLoad(EMPTY_LOAD);
  }, [path]);

  // Load file content.
  useEffect(() => {
    if (!path) return;
    if (UNPRINTABLE_BINARY_EXTS.has(ext)) {
      // Fallback renderer will handle it without needing content.
      setLoad({ ...EMPTY_LOAD, binary: true });
      return;
    }
    let cancelled = false;
    setLoad({ ...EMPTY_LOAD, loading: true });
    (async () => {
      const result = await readFile(path);
      if (cancelled) return;
      if (!result) {
        setLoad({ ...EMPTY_LOAD, error: "Failed to read file." });
        return;
      }
      const size = (result as { size?: number }).size ?? result.content.length;
      const binary =
        (result as { binary?: boolean }).binary === true ||
        result.encoding === "binary";
      // Defer load when the file is large.
      if (!overrideLarge && size > MAX_AUTO_LOAD_BYTES) {
        setLoad({
          ...EMPTY_LOAD,
          size,
          needsConfirm: true,
        });
        return;
      }
      setLoad({
        loading: false,
        error: null,
        content: result.content,
        encoding: binary ? "base64" : "utf-8",
        binary,
        size,
        needsConfirm: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [path, ext, overrideLarge]);

  if (!activeTab) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-6">
        <FileText className="h-8 w-8 opacity-40" strokeWidth={1.5} />
        <p className="text-sm">No file open</p>
        <p className="text-xs">Click a file in the tree to start.</p>
      </div>
    );
  }

  if (activeTab.kind === "diff") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-6">
        <GitCompare className="h-8 w-8 opacity-40" strokeWidth={1.5} />
        <p className="text-sm">Diff viewer — Phase 2</p>
        <p className="text-xs">{activeTab.path}</p>
      </div>
    );
  }

  if (load.loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs">Loading {name}…</p>
      </div>
    );
  }

  if (load.error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-destructive gap-2 p-6">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.5} />
        <p className="text-sm">{load.error}</p>
      </div>
    );
  }

  if (load.needsConfirm) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 p-6">
        <AlertTriangle className="h-6 w-6 text-amber-500" strokeWidth={1.5} />
        <p className="text-sm">Large file</p>
        <p className="text-xs text-muted-foreground">
          {name} is {(load.size / 1024 / 1024).toFixed(1)}&nbsp;MB. Loading
          may be slow.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOverrideLarge(true)}>
          Load anyway
        </Button>
      </div>
    );
  }

  const Renderer = getRenderer(ext);
  return (
    <div className="file-viewer-body h-full overflow-auto px-3.5 py-3">
      <Renderer
        content={load.content}
        encoding={load.encoding}
        ext={ext}
        name={name}
        path={path ?? ""}
        onOpenExternal={openExternal}
      />
    </div>
  );
}
