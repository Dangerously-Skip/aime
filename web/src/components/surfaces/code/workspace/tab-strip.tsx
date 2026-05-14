"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  GitCompare,
  Pin,
  PinOff,
  FileText,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import type { WorkspaceTab } from "@/lib/code-workspace/types";
import { getExt } from "@/lib/code-workspace/fs-tree";

/** Display the file name, falling back to the trailing path segment. */
function displayName(tab: WorkspaceTab): string {
  const segs = tab.path.split(/[\\/]/);
  return segs[segs.length - 1] || tab.path;
}

/** Inline icon for the tab — diff = GitCompare, file = neutral FileText. */
function TabIcon({ tab }: { tab: WorkspaceTab }) {
  if (tab.kind === "diff") {
    return (
      <GitCompare
        className="h-3 w-3 shrink-0 text-amber-500"
        strokeWidth={1.75}
      />
    );
  }
  // Render the extension as a tiny tag — keeps the row scannable without
  // pulling in a heavy icon set per extension.
  const ext = getExt(tab.path).replace(".", "");
  if (!ext) {
    return (
      <FileText
        className="h-3 w-3 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
      />
    );
  }
  return (
    <span className="text-[9px] font-mono uppercase shrink-0 text-muted-foreground tabular-nums w-6 text-right">
      {ext.slice(0, 4)}
    </span>
  );
}

interface TabStripProps {
  workspace: string | null;
}

export function TabStrip({ workspace }: TabStripProps) {
  const { layout, setActiveTab, closeTab, pinTab } = useCodeWorkspace(workspace);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [contextTabId, setContextTabId] = useState<string | null>(null);

  const tabs = layout.openTabs;
  const activeId = layout.activeTabId;

  // Scroll the active tab into view when it changes.
  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeId)}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  if (tabs.length === 0) {
    return (
      <div className="flex items-center h-9 px-2 border-b border-border/40 bg-muted/30 text-xs text-muted-foreground gap-2 shrink-0">
        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>No file open</span>
      </div>
    );
  }

  return (
    <div className="flex items-center h-9 border-b border-border/40 bg-muted/30 shrink-0 overflow-hidden">
      <div
        ref={scrollRef}
        className="flex items-stretch min-w-0 flex-1 overflow-x-auto scrollbar-thin"
        style={{ scrollbarWidth: "thin" }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <DropdownMenu
              key={tab.id}
              open={contextTabId === tab.id}
              onOpenChange={(open) => setContextTabId(open ? tab.id : null)}
            >
              <DropdownMenuTrigger
                data-tab-id={tab.id}
                className={`group inline-flex items-center gap-1.5 px-2 h-9 border-r border-border/40 min-w-0 max-w-[200px] cursor-pointer transition-colors outline-none ${
                  isActive
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
                onClick={(e) => {
                  // Left-click activates the tab (don't open the menu).
                  if (e.button === 0) {
                    e.preventDefault();
                    setActiveTab(tab.id);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextTabId(tab.id);
                }}
                onMouseDown={(e) => {
                  // Middle-click closes.
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                title={tab.path}
              >
                <TabIcon tab={tab} />
                <span
                  className={`truncate text-xs ${
                    tab.pinned ? "" : "italic"
                  } ${isActive ? "text-foreground" : ""}`}
                >
                  {displayName(tab)}
                </span>
                <span
                  role="button"
                  aria-label="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="h-4 w-4 inline-flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted/80 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <X className="h-3 w-3" strokeWidth={1.75} />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                <DropdownMenuItem onClick={() => closeTab(tab.id)}>
                  <X className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
                  Close
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    for (const t of tabs) {
                      if (t.id !== tab.id) closeTab(t.id);
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
                  Close others
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    for (const t of tabs) closeTab(t.id);
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
                  Close all
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {tab.pinned ? (
                  <DropdownMenuItem
                    onClick={() => {
                      // Unpin: pinTab pins; to unpin we replace the tab.
                      // Simplest path — close + reopen as preview.
                      closeTab(tab.id);
                    }}
                  >
                    <PinOff className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
                    Close (was pinned)
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => pinTab(tab.id)}>
                    <Pin className="h-3.5 w-3.5 mr-2" strokeWidth={1.75} />
                    Pin tab
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
    </div>
  );
}
