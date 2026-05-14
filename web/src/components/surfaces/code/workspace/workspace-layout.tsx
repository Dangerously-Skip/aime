"use client";

import { type ReactNode, useState } from "react";
import { Group, Panel, Separator, type PanelSize } from "react-resizable-panels";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { PanelToolbar } from "./panel-toolbar";
import { ChatPlaceholder } from "./placeholders";
import { BranchHeader } from "./branch-header";
import { GitHistory } from "./git-history";
import { FileTree } from "./file-tree";
import { TabStrip } from "./tab-strip";
import { ViewerPane } from "./viewer-pane";
import dynamic from "next/dynamic";

// xterm.js references `self` at module load — defer to the client.
const TerminalPanel = dynamic(
  () => import("./terminal").then((m) => m.TerminalPanel),
  { ssr: false },
);

/**
 * Master workspace layout — chat on the LEFT as the hero, IDE tools on the
 * right. Every region is toggleable + resizable; sizes persist per workspace.
 *
 * Layout, top-down:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Branch header                                  [panel toggles] │
 *   ├──────────────────┬──────────────────────────────────────────────┤
 *   │                  │  ┌────┬─────────────────────────┐            │
 *   │                  │  │    │  tabs                   │            │
 *   │  Chat (hero)     │  │tree│  ─────────────────────  │            │
 *   │                  │  │    │  viewer  /  diff        │            │
 *   │                  │  │    │  ─────────────────────  │            │
 *   │                  │  │    │  terminal (toggle)      │            │
 *   │                  │  └────┴─────────────────────────┘            │
 *   └──────────────────┴──────────────────────────────────────────────┘
 */

interface WorkspaceLayoutProps {
  workspace: string | null;
  /** Folder picker callback used by the default branch header. */
  onFolderChange?: (folder: string | null) => void;
  /** Slot overrides; defaults to the integrated real components. */
  slots?: Partial<{
    branch: ReactNode;
    tree: ReactNode;
    tabs: ReactNode;
    viewer: ReactNode;
    terminal: ReactNode;
    chat: ReactNode;
  }>;
}

export function WorkspaceLayout({ workspace, onFolderChange, slots }: WorkspaceLayoutProps) {
  const { layout, setSize, setVisible } = useCodeWorkspace(workspace);

  // Branch-header default slot owns the history toggle + base-branch override.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);

  const branchSlot =
    slots?.branch ?? (
      <BranchHeader
        workspace={workspace}
        onFolderChange={onFolderChange ?? (() => {})}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        baseBranch={baseBranch}
        onBaseBranchChange={setBaseBranch}
      />
    );
  const treeSlot = slots?.tree ?? <FileTree workspace={workspace} onClose={() => setVisible("tree", false)} />;
  const tabsSlot = slots?.tabs ?? <TabStrip workspace={workspace} />;
  const viewerSlot =
    slots?.viewer
    ?? (historyOpen
      ? <GitHistory workspace={workspace} onClose={() => setHistoryOpen(false)} />
      : <ViewerPane workspace={workspace} />);
  // Only mount TerminalPanel when visible — xterm initialises a DOM-coupled
  // renderer at mount and gets cranky if the host element has 0 dimensions.
  const terminalSlot =
    slots?.terminal
    ?? (layout.visible.terminal
      ? (
        <TerminalPanel
          workspace={workspace}
          visible={layout.visible.terminal}
          onClose={() => setVisible("terminal", false)}
        />
      )
      : null);
  const chatSlot = slots?.chat ?? <ChatPlaceholder onClose={() => setVisible("chat", false)} />;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Branch header strip */}
      {layout.visible.branch && (
        <div className="shrink-0 flex items-center gap-2">
          <div className="flex-1 min-w-0">{branchSlot}</div>
          <div className="pr-3 shrink-0">
            <PanelToolbar workspace={workspace} />
          </div>
        </div>
      )}

      {/* Main horizontal split: chat (hero, left) | IDE column (right) */}
      <div className="flex-1 min-h-0">
        <Group orientation="horizontal" >
          {layout.visible.chat && (
            <>
              <Panel
                defaultSize={layout.sizes.chatWidth}
                minSize={25}
                maxSize={70}
                onResize={(s: PanelSize) => setSize("chatWidth", s.asPercentage)}
              >
                <div className="h-full p-1 pr-0.5">{chatSlot}</div>
              </Panel>
              <Separator className="w-1 hover:bg-primary/30 transition-colors" />
            </>
          )}

          {/* IDE column: tree | (tabs + viewer / terminal) */}
          <Panel minSize={30}>
            <Group orientation="horizontal">
              {layout.visible.tree && (
                <>
                  <Panel
                    defaultSize={layout.sizes.leftWidth}
                    minSize={12}
                    maxSize={40}
                    onResize={(s: PanelSize) => setSize("leftWidth", s.asPercentage)}
                  >
                    <div className="h-full p-1">{treeSlot}</div>
                  </Panel>
                  <Separator className="w-1 hover:bg-primary/30 transition-colors" />
                </>
              )}

              <Panel minSize={30}>
                <Group orientation="vertical">
                  <Panel minSize={20}>
                    <div className="flex flex-col h-full min-h-0 px-0.5">
                      {tabsSlot}
                      <div className="flex-1 min-h-0">{viewerSlot}</div>
                    </div>
                  </Panel>
                  {layout.visible.terminal && terminalSlot && (
                    <>
                      <Separator className="h-1 hover:bg-primary/30 transition-colors" />
                      <Panel
                        defaultSize={layout.sizes.terminalHeight}
                        minSize={10}
                        maxSize={70}
                        onResize={(s: PanelSize) => setSize("terminalHeight", s.asPercentage)}
                      >
                        <div className="h-full p-1 pt-0.5">{terminalSlot}</div>
                      </Panel>
                    </>
                  )}
                </Group>
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
    </div>
  );
}
