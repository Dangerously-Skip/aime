"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * Keybind cheat-sheet. Press `?` anywhere in the IDE workspace to open a
 * floating popover with every shortcut. Esc / click-outside closes it.
 *
 * Ignores `?` typed inside an input, textarea, or contentEditable so we
 * don't hijack the user's typing.
 */

const KEYBINDS: Array<{ keys: string; description: string }> = [
  { keys: "⌘B", description: "Toggle file tree" },
  { keys: "⌘J", description: "Toggle terminal" },
  { keys: "⌘\\", description: "Toggle chat" },
  { keys: "?", description: "Show this help" },
  { keys: "Click file", description: "Open in a new editor tab (dedupes)" },
  { keys: "⌘-click file", description: "Open in an additional tab" },
  { keys: "⌥-click file", description: "Open as diff (working tree vs base)" },
  { keys: "Click M/A/D badge", description: "Open file's diff" },
  { keys: "Drag tab", description: "Move panel — drop on an edge to split, on a tab to stack" },
  { keys: "Right-click tab", description: "Maximize, popout, close, close others" },
  { keys: "+", description: "New terminal (in the toolbar)" },
];

export function KeybindHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "?") return;
      // Ignore when the user is typing in a field
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      e.preventDefault();
      setOpen((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keybind cheat sheet"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/10 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[480px] max-w-[90vw] rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-10 border-b border-border/60">
          <h2 className="text-sm font-semibold text-foreground">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <ul className="py-2">
          {KEYBINDS.map((k) => (
            <li
              key={k.keys + k.description}
              className="flex items-center gap-3 px-4 py-1.5 text-xs"
            >
              <kbd className="font-mono font-semibold text-foreground rounded border border-border bg-background px-1.5 py-0.5 min-w-[3ch] text-center shrink-0">
                {k.keys}
              </kbd>
              <span className="text-foreground/80">{k.description}</span>
            </li>
          ))}
        </ul>
        <div className="px-4 h-9 border-t border-border/60 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
          <span>
            Press <kbd className="font-mono rounded border border-border bg-background px-1">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
