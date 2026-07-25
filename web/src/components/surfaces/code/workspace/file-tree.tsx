"use client";

import { useMemo, useRef } from "react";
import { FolderTree, Loader2, FolderX } from "lucide-react";
import { List, type RowComponentProps } from "react-window";
import { PanelShell } from "./panel-shell";
import { FileTreeFilter } from "./file-tree-filter";
import { FileTreeNode } from "./file-tree-node";
import { useFileTree, type FlatNode } from "@/hooks/use-file-tree";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { useGitStatus } from "@/hooks/use-git-status";
import type { FsNode } from "@/lib/code-workspace/types";

const ROW_HEIGHT = 22;
/** Virtualise once the visible row count crosses this threshold. */
const VIRTUALIZE_THRESHOLD = 500;

interface FileTreeProps {
  workspace: string | null;
  onClose?: () => void;
}

interface RowData {
  flatNodes: FlatNode[];
  onToggle: (path: string) => void;
  onActivate: (node: FsNode, evt: { meta: boolean; shift: boolean; alt: boolean }) => void;
  onPin: (node: FsNode) => void;
  /** path → git status flag ("M"/"A"/"D"/"U"/"R"). */
  gitFlags: Record<string, "M" | "A" | "D" | "U" | "R">;
  /** Folder paths whose descendants contain changes — renders a dot. */
  changedFolders: Set<string>;
  onDiffClick: (node: FsNode) => void;
}

function Row({
  index,
  style,
  flatNodes,
  onToggle,
  onActivate,
  onPin,
  gitFlags,
  changedFolders,
  onDiffClick,
}: RowComponentProps<RowData>) {
  const item = flatNodes[index];
  if (!item) return null;
  return (
    <div style={style}>
      <FileTreeNode
        node={item.node}
        depth={item.depth}
        expanded={item.expanded}
        loading={item.loading}
        onToggleExpand={onToggle}
        onActivate={onActivate}
        onPin={onPin}
        gitFlag={gitFlags[item.node.path]}
        folderHasChanges={item.node.type === "dir" && changedFolders.has(item.node.path)}
        onDiffClick={onDiffClick}
      />
    </div>
  );
}

/**
 * Workspace file tree. Walks the current folder via fs:walk IPC, honours
 * .gitignore (toggleable), and routes clicks to the workspace tab system.
 *
 * Single-click → preview tab. Double-click → pin. Cmd/Ctrl-click → open in
 * an additional pinned tab without replacing the current preview.
 */
// onClose is part of the props contract but this view has no close affordance.
export function FileTree({ workspace }: FileTreeProps) {
  const tree = useFileTree(workspace);
  const { openTab } = useCodeWorkspace(workspace);
  const { status: gitStatus } = useGitStatus(workspace);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Build a path → status-flag lookup the tree row can render. Also build a
  // Set of every ancestor folder so the tree can bubble a small dot up to
  // parent directories (VS Code style — "something inside me changed").
  const { gitFlags, changedFolders } = useMemo(() => {
    const flags: Record<string, "M" | "A" | "D" | "U" | "R"> = {};
    const folders = new Set<string>();
    if (!gitStatus || !workspace) return { gitFlags: flags, changedFolders: folders };
    const root = workspace.replace(/\/+$/, "");
    for (const f of gitStatus.files) {
      const abs = `${root}/${f.path}`;
      const flag =
        f.status === "modified" ? "M" :
        f.status === "added" ? "A" :
        f.status === "deleted" ? "D" :
        f.status === "untracked" ? "U" :
        f.status === "renamed" ? "R" :
        f.status === "staged" ? "M" :
        f.status === "conflicted" ? "U" : null;
      if (!flag) continue;
      flags[abs] = flag;
      // Walk ancestors and mark them. Stop at the workspace root so we
      // don't bubble past the IDE boundary.
      let cur = abs;
      while (cur.length > root.length) {
        const i = cur.lastIndexOf("/");
        if (i <= 0) break;
        cur = cur.slice(0, i);
        if (cur.length <= root.length) break;
        folders.add(cur);
      }
    }
    return { gitFlags: flags, changedFolders: folders };
  }, [gitStatus, workspace]);

  // Click → open as a dockview tab in the editor group. The window-scoped
  // __ideOpenFile / __ideOpenDiff helpers (registered by
  // WorkspaceLayout.onReady) handle dedupe — clicking a file that's
  // already open just focuses the existing tab.
  const openInEditor = (node: FsNode) => {
    if (node.type !== "file") return;
    if (typeof window !== "undefined") {
      const open = (window as unknown as Record<string, unknown>).__ideOpenFile as
        | ((path: string) => void)
        | undefined;
      open?.(node.path);
    }
    openTab({ id: node.path, kind: "file", path: node.path, pinned: false });
  };

  const openDiff = (node: FsNode) => {
    if (node.type !== "file") return;
    if (typeof window !== "undefined") {
      const open = (window as unknown as Record<string, unknown>).__ideOpenDiff as
        | ((path: string) => void)
        | undefined;
      open?.(node.path);
    }
  };

  const handleActivate = (
    node: FsNode,
    evt: { meta: boolean; shift: boolean; alt: boolean },
  ) => {
    if (node.type !== "file") return;
    // Alt/Option-click → open as diff (working-tree vs HEAD).
    if (evt.alt) {
      openDiff(node);
      return;
    }
    openInEditor(node);
  };

  const handlePin = (node: FsNode) => {
    openInEditor(node);
  };

  const rowData = useMemo<RowData>(
    () => ({
      flatNodes: tree.flatNodes,
      onToggle: tree.toggleExpand,
      onActivate: handleActivate,
      onPin: handlePin,
      gitFlags,
      changedFolders,
      onDiffClick: openDiff,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree.flatNodes, tree.toggleExpand, workspace, gitFlags, changedFolders],
  );

  const shouldVirtualize = tree.flatNodes.length >= VIRTUALIZE_THRESHOLD;

  const body = (() => {
    if (!workspace) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4 gap-2 text-muted-foreground">
          <FolderX className="h-6 w-6 opacity-50" strokeWidth={1.5} />
          <p className="text-xs">No folder open.</p>
          <p className="text-[11px] text-muted-foreground/70">
            Pick a folder below to start.
          </p>
        </div>
      );
    }

    if (tree.loading && tree.flatNodes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <p className="text-xs">Reading folder…</p>
        </div>
      );
    }

    if (tree.error) {
      return (
        <div className="p-3 text-xs text-destructive">
          {tree.error}
        </div>
      );
    }

    if (tree.flatNodes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-4 gap-2 text-muted-foreground">
          <FolderTree className="h-6 w-6 opacity-50" strokeWidth={1.5} />
          <p className="text-xs">
            {tree.filter ? "No matches." : "Empty folder."}
          </p>
        </div>
      );
    }

    if (shouldVirtualize) {
      return (
        <div className="h-full">
          <List
            rowComponent={Row}
            rowCount={tree.flatNodes.length}
            rowHeight={ROW_HEIGHT}
            rowProps={rowData}
            defaultHeight={400}
            overscanCount={8}
          />
        </div>
      );
    }

    return (
      <div ref={scrollContainerRef} className="py-1">
        {tree.flatNodes.map((item) => (
          <FileTreeNode
            key={item.node.path}
            node={item.node}
            depth={item.depth}
            expanded={item.expanded}
            loading={item.loading}
            onToggleExpand={tree.toggleExpand}
            onActivate={handleActivate}
            onPin={handlePin}
            gitFlag={gitFlags[item.node.path]}
            folderHasChanges={item.node.type === "dir" && changedFolders.has(item.node.path)}
            onDiffClick={openDiff}
          />
        ))}
      </div>
    );
  })();

  return (
    <PanelShell>
      <div className="flex flex-col h-full min-h-0">
        <FileTreeFilter
          value={tree.filter}
          onChange={tree.setFilter}
          showHidden={tree.showHidden}
          onToggleHidden={() => tree.setShowHidden(!tree.showHidden)}
        />
        {tree.contentSearchPlaceholder && (
          <div className="px-2 py-1 text-[10px] text-muted-foreground bg-amber-50/40 dark:bg-amber-950/20 border-b border-amber-200/40">
            Content search coming in a later phase — filtering by filename
            for now.
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto">{body}</div>
      </div>
    </PanelShell>
  );
}
