"use client";

import { useEffect } from "react";
import {
  PanelLeft,
  PanelRight,
  PanelBottom,
  RotateCcw,
  Plus,
} from "lucide-react";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import type { PanelSlot } from "@/lib/code-workspace/types";

const KEY_TO_SLOT: Record<string, PanelSlot> = {
  b: "tree",
  j: "terminal",
  "\\": "chat",
};

interface PanelToolbarProps {
  workspace: string | null;
}

export function PanelToolbar({ workspace }: PanelToolbarProps) {
  const { layout, togglePanel, resetLayout } = useCodeWorkspace(workspace);

  // Keybinds: Cmd+B (tree), Cmd+J (terminal), Cmd+\ (chat).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const slot = KEY_TO_SLOT[e.key.toLowerCase()];
      if (!slot) return;
      e.preventDefault();
      togglePanel(slot);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  const btn = (active: boolean) =>
    `h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors ${
      active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
    }`;

  return (
    <div className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => togglePanel("tree")}
        className={btn(layout.visible.tree)}
        title="Toggle file tree (⌘B)"
        aria-pressed={layout.visible.tree}
      >
        <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => togglePanel("terminal")}
        className={btn(layout.visible.terminal)}
        title="Toggle terminal (⌘J)"
        aria-pressed={layout.visible.terminal}
      >
        <PanelBottom className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => togglePanel("chat")}
        className={btn(layout.visible.chat)}
        title="Toggle chat (⌘\\)"
        aria-pressed={layout.visible.chat}
      >
        <PanelRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={() => {
          if (typeof window === "undefined") return;
          const open = (window as unknown as Record<string, unknown>).__ideOpenTerminal as
            | (() => void)
            | undefined;
          open?.();
        }}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title="New terminal"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={resetLayout}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        title="Reset layout"
      >
        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
