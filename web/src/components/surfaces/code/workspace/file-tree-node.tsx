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
export function FileTreeNode({
  node,
  depth,
  expanded,
  loading,
  onToggleExpand,
  onActivate,
  onPin,
}: FileTreeNodeProps) {
  const isDir = node.type === "dir";
  const Icon = isDir ? (expanded ? FolderOpen : Folder) : fileIconFor(node.name);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
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
    </button>
  );
}
