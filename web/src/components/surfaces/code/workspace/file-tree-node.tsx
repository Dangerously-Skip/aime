"use client";

import { type MouseEvent } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File as FileIcon,
  FileCode2,
  FileText,
  FileImage,
  FileJson,
  Loader2,
} from "lucide-react";
import type { FsNode } from "@/lib/code-workspace/types";
import { getExt } from "@/lib/code-workspace/fs-tree";

interface FileTreeNodeProps {
  node: FsNode;
  /** Depth from the workspace root — drives indent. */
  depth: number;
  expanded: boolean;
  loading?: boolean;
  onToggleExpand: (path: string) => void;
  onActivate: (node: FsNode, evt: { meta: boolean; shift: boolean; alt: boolean }) => void;
  onPin: (node: FsNode) => void;
  /** Optional git status flag — drives the M/A/D badge on the right edge. */
  gitFlag?: "M" | "A" | "D" | "U" | "R";
  /** True when a directory contains changed descendants (renders a dot). */
  folderHasChanges?: boolean;
  /** Click the diff badge → open diff tab instead of file. */
  onDiffClick?: (node: FsNode) => void;
}

/** Best-effort icon for a file extension. Falls back to generic FileIcon. */
function fileIconFor(name: string) {
  const ext = getExt(name);
  if ([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"].includes(ext)) return FileImage;
  if ([".json", ".jsonc"].includes(ext)) return FileJson;
  if ([".md", ".mdx", ".txt", ".log", ".csv", ".tsv"].includes(ext)) return FileText;
  if (
    [
      ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
      ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
      ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".sh",
      ".css", ".scss", ".less", ".html", ".vue", ".svelte",
      ".yml", ".yaml", ".toml", ".xml",
    ].includes(ext)
  ) {
    return FileCode2;
  }
  return FileIcon;
}

/**
 * One row of the file tree. The parent owns expand/collapse state and child
 * resolution — this component is a pure presentation node + click handler.
 */
const GIT_FLAG_COLOR: Record<string, string> = {
  M: "text-amber-500",
  A: "text-emerald-500",
  D: "text-destructive",
  U: "text-orange-500",
  R: "text-sky-500",
};

export function FileTreeNode({
  node,
  depth,
  expanded,
  loading,
  onToggleExpand,
  onActivate,
  onPin,
  gitFlag,
  folderHasChanges,
  onDiffClick,
}: FileTreeNodeProps) {
  const isDir = node.type === "dir";
  const Icon = isDir ? (expanded ? FolderOpen : Folder) : fileIconFor(node.name);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    // eslint-disable-next-line no-console
    console.log("[file-tree-node] click", node.type, node.path);
    if (isDir) {
      onToggleExpand(node.path);
      return;
    }
    onActivate(node, {
      meta: e.metaKey || e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
    });
  }

  function handleDoubleClick() {
    if (isDir) return;
    onPin(node);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className="flex items-center w-full gap-1 px-2 py-0.5 text-xs text-left hover:bg-muted/60 transition-colors group focus:outline-none focus:bg-muted/60"
      style={{ paddingLeft: 8 + depth * 12 }}
      title={node.path}
    >
      {isDir ? (
        loading ? (
          <Loader2 className="h-3 w-3 shrink-0 text-muted-foreground animate-spin" />
        ) : expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${isDir ? "text-amber-500/70" : "text-muted-foreground"}`}
        strokeWidth={1.75}
      />
      <span className="truncate flex-1 text-foreground/90 group-hover:text-foreground">
        {node.name}
      </span>
      {isDir && folderHasChanges && (
        <span
          className="ml-1 inline-flex h-2 w-2 rounded-full bg-amber-500/80 shrink-0"
          aria-label="Folder contains uncommitted changes"
          title="Contains uncommitted changes"
        />
      )}
      {!isDir && gitFlag && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onDiffClick?.(node);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onDiffClick?.(node);
            }
          }}
          title={`${
            gitFlag === "M" ? "Modified" :
            gitFlag === "A" ? "Added" :
            gitFlag === "D" ? "Deleted" :
            gitFlag === "U" ? "Untracked" :
            gitFlag === "R" ? "Renamed" : "Changed"
          } — click to view diff`}
          className={`ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-mono font-semibold cursor-pointer hover:bg-muted ${GIT_FLAG_COLOR[gitFlag] ?? "text-muted-foreground"}`}
        >
          {gitFlag}
        </span>
      )}
    </button>
  );
}
