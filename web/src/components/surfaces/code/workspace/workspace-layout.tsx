"use client";

import { type ReactNode, useState } from "react";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { PanelToolbar } from "./panel-toolbar";
import { ChatPlaceholder } from "./placeholders";
import { BranchHeader } from "./branch-header";
import { GitHistory } from "./git-history";
import { FileTree } from "./file-tree";
import { TabStrip } from "./tab-strip";
import { ViewerPane } from "./viewer-pane";
import { SplitPane } from "./split-pane";
import dynamic from "next/dynamic";

// xterm.js references `self` at module load — defer to the client.
const TerminalPanel = dynamic(
  () => import("./terminal").then((m) => m.TerminalPanel),
  { ssr: false },
);

/**
 * Master workspace layout — chat on the LEFT as the hero, IDE tools on the
 * right. Every region toggleable + resizable; sizes persist per workspace.
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  Branch header                                  [panel toggles] │
 *   ├──────────────────┬──────────────────────────────────────────────┤
 *   │                  │  ┌────┬─────────────────────────┐            │
 *   │  Chat (hero)     │  │tree│  tabs + viewer/diff     │            │
 *   │                  │  │    │  ─────────────────────  │            │
 *   │                  │  │    │  terminal (toggle)      │            │
 *   └──────────────────┴──────────────────────────────────────────────┘
 *
 * SplitPane (CSS flexbox) is our own component — react-resizable-panels v4
 * was unreliable inside nested groups, and we want the Zustand store to be
 * the single source of truth for sizes.
 */

interface WorkspaceLayoutProps {
  workspace: string | null;
  onFolderChange?: (folder: string | null) => void;
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
  const viewerBody =
    slots?.viewer
    ?? (historyOpen
      ? <GitHistory workspace={workspace} onClose={() => setHistoryOpen(false)} />
      : <ViewerPane workspace={workspace} />);
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

  // Inner-most: viewer pane (tabs + body), split vertically against terminal
  const viewerStack = (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0">{tabsSlot}</div>
      <div className="flex-1 min-h-0">{viewerBody}</div>
    </div>
  );

  const viewerOrTerminal =
    layout.visible.terminal && terminalSlot ? (
      <SplitPane
        orientation="vertical"
        firstSize={100 - layout.sizes.terminalHeight}
        minFirst={30}
        maxFirst={90}
        onResize={(s) => setSize("terminalHeight", 100 - s)}
        first={viewerStack}
        second={<div className="h-full p-1 pt-0.5">{terminalSlot}</div>}
      />
    ) : (
      viewerStack
    );

  // Middle: tree | (viewer / terminal)
  const ideColumn = layout.visible.tree ? (
    <SplitPane
      orientation="horizontal"
      firstSize={layout.sizes.leftWidth}
      minFirst={12}
      maxFirst={40}
      onResize={(s) => setSize("leftWidth", s)}
      first={<div className="h-full p-1">{treeSlot}</div>}
      second={<div className="h-full">{viewerOrTerminal}</div>}
    />
  ) : (
    <div className="h-full">{viewerOrTerminal}</div>
  );

  // Outer: chat | IDE column
  const main = layout.visible.chat ? (
    <SplitPane
      orientation="horizontal"
      firstSize={layout.sizes.chatWidth}
      minFirst={25}
      maxFirst={70}
      onResize={(s) => setSize("chatWidth", s)}
      first={<div className="h-full p-1 pr-0.5">{chatSlot}</div>}
      second={<div className="h-full">{ideColumn}</div>}
    />
  ) : (
    <div className="h-full">{ideColumn}</div>
  );

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-background">
      {layout.visible.branch && (
        <div className="shrink-0 flex items-center gap-2">
          <div className="flex-1 min-w-0">{branchSlot}</div>
          <div className="pr-3 shrink-0">
            <PanelToolbar workspace={workspace} />
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">{main}</div>
    </div>
  );
}
