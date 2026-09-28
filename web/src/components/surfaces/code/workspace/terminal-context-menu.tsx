"use client";

import { useEffect, useRef } from "react";

/**
 * The terminal's right-click menu.
 *
 * Right-click used to copy when there was a selection and otherwise PASTE THE
 * CLIPBOARD STRAIGHT INTO THE SHELL — so a copied command ending in a newline
 * ran on a stray right-click. Paste is now an explicit menu item, and what it
 * sends goes through `preparePaste` and xterm's own `paste()`.
 */

export type TerminalAction = "copy" | "paste" | "clear";

/** The slice of xterm the actions need — lets them run against a fake in tests. */
export interface TerminalLike {
  getSelection(): string;
  hasSelection(): boolean;
  /** xterm's paste: wraps in bracketed-paste markers when the shell asked for them. */
  paste(data: string): void;
  clear(): void;
  focus(): void;
}

export interface ClipboardLike {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/**
 * Trailing line breaks are removed so a pasted command waits for Enter. xterm's
 * `paste()` additionally brackets the text when the shell has enabled
 * bracketed-paste mode (zsh, bash ≥ 5.1, fish), so embedded newlines don't
 * execute either; this covers shells that have not.
 */
export function preparePaste(text: string): string {
  return text.replace(/[\r\n]+$/, "");
}

export async function runTerminalAction(
  action: TerminalAction,
  term: TerminalLike,
  clipboard: ClipboardLike,
): Promise<void> {
  if (action === "copy") {
    const sel = term.getSelection();
    if (sel) await clipboard.writeText(sel);
  } else if (action === "paste") {
    const text = preparePaste(await clipboard.readText());
    if (text) term.paste(text);
  } else {
    term.clear();
  }
  term.focus();
}

interface TerminalContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onAction: (action: TerminalAction) => void;
  onClose: () => void;
}

export function TerminalContextMenu({ x, y, hasSelection, onAction, onClose }: TerminalContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const items: Array<{ action: TerminalAction; label: string; kbd?: string; disabled?: boolean }> = [
    { action: "copy", label: "Copy", kbd: "⌘C", disabled: !hasSelection },
    { action: "paste", label: "Paste", kbd: "⌘V" },
    { action: "clear", label: "Clear", kbd: "⌘K" },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Terminal"
      className="absolute z-50 min-w-[9rem] rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onAction(item.action);
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none"
        >
          <span className="flex-1">{item.label}</span>
          {item.kbd && <span className="font-mono text-[10px] text-muted-foreground">{item.kbd}</span>}
        </button>
      ))}
    </div>
  );
}
