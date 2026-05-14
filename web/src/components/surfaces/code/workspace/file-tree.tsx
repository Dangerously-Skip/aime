"use client";

import { useMemo, useRef } from "react";
import { FolderTree, Loader2, FolderX } from "lucide-react";
import { List, type RowComponentProps } from "react-window";
import { PanelShell } from "./panel-shell";
import { FileTreeFilter } from "./file-tree-filter";
import { FileTreeNode } from "./file-tree-node";
import { useFileTree, type FlatNode } from "@/hooks/use-file-tree";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
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
  onActivate: (node: FsNode, evt: { meta: boolean; shift: boolean }) => void;
  onPin: (node: FsNode) => void;
}

function Row({
  index,
  style,
  flatNodes,
  onToggle,
  onActivate,
  onPin,
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
export function FileTree({ workspace, onClose }: FileTreeProps) {
  const tree = useFileTree(workspace);
  const { openTab } = useCodeWorkspace(workspace);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const handleActivate = (
    node: FsNode,
    evt: { meta: boolean; shift: boolean },
  ) => {
    if (node.type !== "file") return;
    // Cmd-click → open as additional pinned tab (don't replace preview).
    if (evt.meta) {
      openTab({ id: node.path, kind: "file", path: node.path, pinned: true });
      return;
    }
    openTab({ id: node.path, kind: "file", path: node.path, pinned: false });
  };

  const handlePin = (node: FsNode) => {
    if (node.type !== "file") return;
    openTab({ id: node.path, kind: "file", path: node.path, pinned: true });
  };

  const rowData = useMemo<RowData>(
    () => ({
      flatNodes: tree.flatNodes,
      onToggle: tree.toggleExpand,
      onActivate: handleActivate,
      onPin: handlePin,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree.flatNodes, tree.toggleExpand, workspace],
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
          />
        ))}
      </div>
    );
  })();

  return (
    <PanelShell icon={FolderTree} title="Files" onClose={onClose}>
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
