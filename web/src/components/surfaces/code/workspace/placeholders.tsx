"use client";

import { MessageSquare } from "lucide-react";
import { PanelShell } from "./panel-shell";

/**
 * Slot placeholders for any Wave 2 phase not yet integrated.
 *
 * After Wave 3 merge: only the Chat slot still uses a placeholder — the
 * Code-surface composer is wired through the slot prop by code-surface.tsx.
 * Tree / tabs / viewer / branch / terminal all have real implementations.
 */

export function ChatPlaceholder({ onClose }: { onClose?: () => void }) {
  return (
    <PanelShell icon={MessageSquare} title="Chat" onClose={onClose}>
      <div className="p-3 text-xs text-muted-foreground">
        Code-surface chat composer mounts here via the `chat` slot prop.
      </div>
    </PanelShell>
  );
}
