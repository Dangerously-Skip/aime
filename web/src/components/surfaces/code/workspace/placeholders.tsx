"use client";

import {
  FolderTree,
  GitBranch,
  GitCommit,
  FileText,
  MessageSquare,
} from "lucide-react";
import { PanelShell } from "./panel-shell";

/**
 * Wave 1 placeholders. Each is owned by a Wave 2 agent.
 *
 * Agents replace these one-for-one with the real implementation; the
 * PanelShell + props stay so the layout still slots cleanly.
 */

export function TreePlaceholder({ onClose }: { onClose?: () => void }) {
  return (
    <PanelShell icon={FolderTree} title="Files" onClose={onClose}>
      <div className="p-3 text-xs text-muted-foreground">
        File tree — coming via Phase 1 (Agent A).
      </div>
    </PanelShell>
  );
}

export function TabsPlaceholder() {
  return (
    <div className="flex items-center h-9 px-2 border-b border-border/40 bg-muted/30 text-xs text-muted-foreground gap-2">
      <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span>No file open</span>
    </div>
  );
}

export function ViewerPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-6">
      <FileText className="h-8 w-8 opacity-40" strokeWidth={1.5} />
      <p className="text-sm">Viewer — Phase 1 lands here</p>
      <p className="text-xs">Click a file in the tree to open it.</p>
    </div>
  );
}

// TerminalPlaceholder removed — Phase 4 ships the real `TerminalPanel`
// (web/src/components/surfaces/code/workspace/terminal.tsx).

export function ChatPlaceholder({ onClose }: { onClose?: () => void }) {
  return (
    <PanelShell icon={MessageSquare} title="Chat" onClose={onClose}>
      <div className="p-3 text-xs text-muted-foreground">
        Existing Code-surface chat mounts here.
      </div>
    </PanelShell>
  );
}

export function BranchHeaderPlaceholder() {
  return (
    <div className="flex items-center h-10 px-3 border-b border-border/40 bg-muted/20 gap-2">
      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
      <span className="text-xs font-medium text-foreground/80">main</span>
      <span className="text-xs text-muted-foreground">←</span>
      <span className="text-xs font-mono text-muted-foreground">no branch</span>
      <div className="flex-1" />
      <GitCommit className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
      <span className="text-xs text-muted-foreground">history — Phase 3</span>
    </div>
  );
}
