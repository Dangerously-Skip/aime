"use client";

import { useEffect, useState } from "react";
import {
  PanelsTopLeft,
  Eye,
  GitCompare,
  Terminal as TerminalIcon,
  FolderTree,
  MessageSquare,
  Check,
  HelpCircle,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

interface PanelToolbarProps {
  workspace: string | null;
}

/**
 * Replaces the old icon row with a single "Panels" dropdown — Claude Code
 * style. Each row shows the panel name, its keybind, and a checkmark when
 * visible. Action buttons (new terminal, help, reset) stay as a tidy
 * secondary cluster to the right.
 */
export function PanelToolbar({ workspace }: PanelToolbarProps) {
  const { layout, togglePanel, resetLayout } = useCodeWorkspace(workspace);
  const [open, setOpen] = useState(false);

  // Keybinds: Cmd+B (tree), Cmd+J (terminal), Cmd+\ (chat),
  // Cmd+Shift+D (diff — opens the active file's diff if any),
  // Cmd+Shift+F (focus tree filter), ? (help).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;
      const key = e.key.toLowerCase();
      if (e.shiftKey && key === "d") {
        e.preventDefault();
        // Best-effort: ask the global diff opener for the active file
        // (file tree owns that; for now we just nudge the user).
        return;
      }
      if (!e.shiftKey && !e.altKey) {
        if (key === "b") {
          e.preventDefault();
          togglePanel("tree");
        } else if (key === "j") {
          e.preventDefault();
          togglePanel("terminal");
        } else if (key === "\\") {
          e.preventDefault();
          togglePanel("chat");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  const items: Array<{
    key: "chat" | "tree" | "terminal";
    label: string;
    icon: typeof Eye;
    kbd: string;
  }> = [
    { key: "chat", label: "Chat", icon: MessageSquare, kbd: "⌘\\" },
    { key: "tree", label: "Files", icon: FolderTree, kbd: "⌘B" },
    { key: "terminal", label: "Terminal", icon: TerminalIcon, kbd: "⌘J" },
  ];

  function fireHelp() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
  }

  function newTerminal() {
    if (typeof window === "undefined") return;
    const open = (window as unknown as Record<string, unknown>).__ideOpenTerminal as
      | (() => void)
      | undefined;
    open?.();
  }

  return (
    <div className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="h-7 inline-flex items-center justify-center rounded-md px-2 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors gap-1.5"
              title="Panels"
              aria-label="Panels"
            />
          }
        >
          <PanelsTopLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="text-xs">Panels</span>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end" className="w-56 p-1">
          {items.map((item) => {
            const visible = layout.visible[item.key];
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  togglePanel(item.key);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                aria-pressed={visible}
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                <span className="flex-1">{item.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{item.kbd}</span>
                {visible && <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2} />}
              </button>
            );
          })}
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => {
              newTerminal();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
            <span className="flex-1">New terminal</span>
          </button>
          <button
            type="button"
            onClick={() => {
              fireHelp();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
          >
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
            <span className="flex-1">Shortcuts</span>
            <span className="font-mono text-[10px] text-muted-foreground">?</span>
          </button>
          <button
            type="button"
            onClick={() => {
              resetLayout();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
          >
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
            <span className="flex-1">Reset layout</span>
          </button>
        </PopoverContent>
      </Popover>
      <div className="hidden md:inline-flex items-center gap-2 pl-1 text-[10px] text-muted-foreground">
        <GitCompare className="h-3 w-3" strokeWidth={1.75} />
        <span>
          Alt-click a file or M-badge to diff
        </span>
      </div>
    </div>
  );
}
