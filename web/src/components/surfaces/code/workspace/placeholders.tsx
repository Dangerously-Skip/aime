"use client";

import { PanelShell } from "./panel-shell";

/**
 * Slot placeholder for the Chat surface when the code-surface composer
 * isn't wired through the `chat` slot prop (legacy paths only — Wave 3
 * code-surface always passes a real composer).
 */

export function ChatPlaceholder() {
  return (
    <PanelShell>
      <div className="p-3 text-xs text-muted-foreground">
        Code-surface chat composer mounts here via the `chat` slot prop.
      </div>
    </PanelShell>
  );
}
