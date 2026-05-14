"use client";

import { type ReactNode } from "react";
import { Group, Panel, Separator, type PanelSize } from "react-resizable-panels";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { PanelToolbar } from "./panel-toolbar";
import {
  TreePlaceholder,
  TabsPlaceholder,
  ViewerPlaceholder,
  TerminalPlaceholder,
  ChatPlaceholder,
  BranchHeaderPlaceholder,
} from "./placeholders";

/**
 * Master workspace layout for the IDE mode of the Code surface.
 *
 * Six toggleable, resizable regions. Wave 2 agents replace the placeholder
 * components below one-for-one. The layout state (visibility, sizes, slot
 * assignments) is persisted per workspace via `useCodeWorkspace`.
 */

interface WorkspaceLayoutProps {
  workspace: string | null;
  /**
   * Slot overrides — Wave 2 agents pass their real components here so the
   * layout stays in one place. Falling back to placeholders when a slot
   * isn't yet implemented.
   */
  slots?: Partial<{
    branch: ReactNode;
    tree: ReactNode;
    tabs: ReactNode;
    viewer: ReactNode;
    terminal: ReactNode;
    chat: ReactNode;
  }>;
}

export function WorkspaceLayout({ workspace, slots }: WorkspaceLayoutProps) {
  const { layout, setSize, setVisible } = useCodeWorkspace(workspace);

  // Resolve each slot — caller's component, or our placeholder
  const branchSlot = slots?.branch ?? <BranchHeaderPlaceholder />;
  const treeSlot = slots?.tree ?? <TreePlaceholder onClose={() => setVisible("tree", false)} />;
  const tabsSlot = slots?.tabs ?? <TabsPlaceholder />;
  const viewerSlot = slots?.viewer ?? <ViewerPlaceholder />;
  const terminalSlot = slots?.terminal ?? <TerminalPlaceholder onClose={() => setVisible("terminal", false)} />;
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

      {/* Main 3-column grid: tree | center | chat */}
      <div className="flex-1 min-h-0">
        <Group orientation="horizontal" id={`code-ws-${workspace ?? "none"}-h`}>
          {layout.visible.tree && (
            <>
              <Panel
                defaultSize={layout.sizes.leftWidth}
                minSize={12}
                maxSize={40}
                onResize={(s: PanelSize) => setSize("leftWidth", s.asPercentage)}
              >
                <div className="h-full p-1 pr-0.5">{treeSlot}</div>
              </Panel>
              <Separator className="w-1 hover:bg-primary/30 transition-colors" />
            </>
          )}

          {/* Center: tabs + viewer split vertically against terminal */}
          <Panel minSize={30}>
            <Group orientation="vertical" id={`code-ws-${workspace ?? "none"}-v`}>
              <Panel minSize={20}>
                <div className="flex flex-col h-full min-h-0 px-0.5">
                  {tabsSlot}
                  <div className="flex-1 min-h-0">{viewerSlot}</div>
                </div>
              </Panel>
              {layout.visible.terminal && (
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

          {layout.visible.chat && (
            <>
              <Separator className="w-1 hover:bg-primary/30 transition-colors" />
              <Panel
                defaultSize={layout.sizes.rightWidth}
                minSize={20}
                maxSize={60}
                onResize={(s: PanelSize) => setSize("rightWidth", s.asPercentage)}
              >
                <div className="h-full p-1 pl-0.5">{chatSlot}</div>
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  );
}
