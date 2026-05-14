"use client";

import { Terminal, MessageSquare } from "lucide-react";
import { PanelShell } from "./panel-shell";

/**
 * Slot placeholders owned by Wave 2 phases not yet integrated.
 *
 * Phase 1 (Agent A — tree + tabs + viewer) replaced its placeholders with
 * real components — see `file-tree.tsx`, `tab-strip.tsx`, `viewer-pane.tsx`.
 * The remaining placeholders below stay until Agents C and D land.
 */

export function TerminalPlaceholder({ onClose }: { onClose?: () => void }) {
  return (
    <PanelShell icon={Terminal} title="Terminal" onClose={onClose}>
      <div className="p-3 text-xs text-muted-foreground font-mono">
        $ <span className="opacity-50">terminal — coming via Phase 4 (Agent D)</span>
      </div>
    </PanelShell>
  );
}

export function ChatPlaceholder({ onClose }: { onClose?: () => void }) {
  return (
    <PanelShell icon={MessageSquare} title="Chat" onClose={onClose}>
      <div className="p-3 text-xs text-muted-foreground">
        Existing Code-surface chat mounts here.
      </div>
    </PanelShell>
  );
}

