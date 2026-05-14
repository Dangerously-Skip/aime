"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DockviewReact,
  themeAbyssSpaced,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { PanelToolbar } from "./panel-toolbar";
import { BranchHeader } from "./branch-header";
import { GitHistory } from "./git-history";
import { FileTree } from "./file-tree";
import { TabStrip } from "./tab-strip";
import { ViewerPane } from "./viewer-pane";
import { DiffViewer } from "./diff-viewer";
import dynamic from "next/dynamic";
import "dockview/dist/styles/dockview.css";
import "./workspace-dockview.css";

const TerminalPanel = dynamic(
  () => import("./terminal").then((m) => m.TerminalPanel),
  { ssr: false },
);

/**
 * IDE workspace layout, dockview edition.
 *
 * Six panels — chat (hero), tree, viewer, terminal, history, diff — each a
 * draggable / stackable region. Drop a tab on another region's edge to
 * split; drop on the body to stack as a tab. Layout JSON is persisted per
 * workspace in our Zustand store.
 *
 * Styling: themeAbyssSpaced base + our own override CSS for rounded
 * corners, soft borders, Claude Code aesthetic. See workspace-dockview.css.
 */

interface WorkspaceContext {
  workspace: string | null;
  setVisible: (slot: string, visible: boolean) => void;
  historyOpen: boolean;
  setHistoryOpen: (v: boolean) => void;
  baseBranch: string | null;
  setBaseBranch: (b: string | null) => void;
  onFolderChange: (f: string | null) => void;
  /** Slot overrides from the parent (e.g. real chat composer from code-surface). */
  slots: Partial<Record<"chat" | "tree" | "tabs" | "viewer" | "terminal" | "branch", ReactNode>>;
}

// ── Panel components ─────────────────────────────────────────────────────
// dockview hands each registered component a props object; we read the
// workspace context via `params` set in addPanel.

function ChatRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { slots } = props.params;
  return (
    <div className="dv-region-body">
      {slots.chat ?? (
        <div className="p-4 text-xs text-muted-foreground">
          Chat composer mounts here when wired by code-surface.
        </div>
      )}
    </div>
  );
}

function TreeRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { workspace, slots } = props.params;
  return <div className="dv-region-body">{slots.tree ?? <FileTree workspace={workspace} />}</div>;
}

function ViewerRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { workspace, historyOpen, setHistoryOpen, slots } = props.params;
  if (slots.viewer) return <div className="dv-region-body">{slots.viewer}</div>;
  return (
    <div className="dv-region-body flex flex-col h-full min-h-0">
      <div className="shrink-0">{slots.tabs ?? <TabStrip workspace={workspace} />}</div>
      <div className="flex-1 min-h-0">
        {historyOpen
          ? <GitHistory workspace={workspace} onClose={() => setHistoryOpen(false)} />
          : <ViewerPane workspace={workspace} />}
      </div>
    </div>
  );
}

function TerminalRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { workspace, slots } = props.params;
  if (slots.terminal) return <div className="dv-region-body">{slots.terminal}</div>;
  return (
    <div className="dv-region-body">
      <TerminalPanel workspace={workspace} visible />
    </div>
  );
}

/**
 * Diff tab — opened on demand when the user clicks a modified file in the
 * tree. Each diff is its own panel keyed by `diff:<path>` so multiple diffs
 * can coexist as tabs in the viewer group.
 */
interface DiffPanelParams extends WorkspaceContext {
  filePath: string;
  fromRef?: string;
  toRef?: string;
}

function DiffRegion(props: IDockviewPanelProps<DiffPanelParams>) {
  const { workspace, filePath, fromRef, toRef } = props.params;
  if (!workspace) {
    return (
      <div className="dv-region-body p-4 text-xs text-muted-foreground">
        No workspace selected.
      </div>
    );
  }
  return (
    <div className="dv-region-body">
      <DiffViewer
        workspace={workspace}
        filePath={filePath}
        fromRef={fromRef}
        toRef={toRef}
        onClose={() => props.api.close()}
      />
    </div>
  );
}

const COMPONENTS = {
  chat: ChatRegion,
  tree: TreeRegion,
  viewer: ViewerRegion,
  terminal: TerminalRegion,
  diff: DiffRegion,
} as const;

// ── Default layout ──────────────────────────────────────────────────────
// Chat hero on the left at ~40%; tree as a narrow rail; viewer dominant; terminal
// stacks below viewer (hidden by default — user toggles via the panel toolbar).

function buildDefaultLayout(): unknown {
  return {
    grid: {
      orientation: "HORIZONTAL",
      height: 1000,
      width: 1600,
      root: {
        type: "branch",
        size: 1600,
        data: [
          {
            type: "leaf",
            size: 640, // ~40% chat
            data: { views: ["chat"], activeView: "chat", id: "chat-region" },
          },
          {
            type: "branch",
            size: 960,
            data: [
              {
                type: "leaf",
                size: 220, // tree rail
                data: { views: ["tree"], activeView: "tree", id: "tree-region" },
              },
              {
                type: "leaf",
                size: 740, // viewer
                data: { views: ["viewer"], activeView: "viewer", id: "viewer-region" },
              },
            ],
          },
        ],
      },
    },
    panels: {
      chat:    { id: "chat",     contentComponent: "chat",     title: "Chat" },
      tree:    { id: "tree",     contentComponent: "tree",     title: "Files" },
      viewer:  { id: "viewer",   contentComponent: "viewer",   title: "Editor" },
    },
    activeGroup: "chat-region",
  };
}

// ────────────────────────────────────────────────────────────────────────

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

export function WorkspaceLayout({ workspace, onFolderChange, slots = {} }: WorkspaceLayoutProps) {
  const { layout } = useCodeWorkspace(workspace);
  const apiRef = useRef<DockviewApi | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);

  // Context object passed to every panel via params.
  const ctx: WorkspaceContext = {
    workspace,
    setVisible: () => {}, // unused — dockview owns visibility now
    historyOpen,
    setHistoryOpen,
    baseBranch,
    setBaseBranch,
    onFolderChange: onFolderChange ?? (() => {}),
    slots,
  };

  function onReady(event: DockviewReadyEvent) {
    apiRef.current = event.api;
    try {
      event.api.fromJSON(buildDefaultLayout() as never);
    } catch (err) {
      console.error("[ide] failed to apply default layout", err);
    }
    for (const panel of event.api.panels) {
      panel.api.updateParameters(ctx as unknown as Record<string, unknown>);
    }
    // Expose a window-scoped API so the file tree / branch header can
    // request diff tabs without prop drilling through dockview's params.
    (window as unknown as Record<string, unknown>).__ideOpenDiff = (
      filePath: string,
      opts?: { fromRef?: string; toRef?: string },
    ) => {
      const id = `diff:${filePath}`;
      const existing = event.api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }
      event.api.addPanel({
        id,
        component: "diff",
        title: filePath.split("/").pop() ?? filePath,
        params: { ...ctx, filePath, fromRef: opts?.fromRef, toRef: opts?.toRef } as unknown as Record<string, unknown>,
        position: { referencePanel: "viewer", direction: "within" },
      });
    };
  }

  // Push ctx changes (historyOpen, slots…) to every panel
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const panel of api.panels) {
      panel.api.updateParameters(ctx as unknown as Record<string, unknown>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, slots, workspace, baseBranch]);

  // Add / remove the terminal panel reactively
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel("terminal");
    if (layout.visible.terminal && !existing) {
      api.addPanel({
        id: "terminal",
        component: "terminal",
        title: "Terminal",
        params: ctx as unknown as Record<string, unknown>,
        position: { referencePanel: "viewer", direction: "below" },
      });
    } else if (!layout.visible.terminal && existing) {
      existing.api.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.visible.terminal]);

  const branchSlot =
    slots.branch ?? (
      <BranchHeader
        workspace={workspace}
        onFolderChange={onFolderChange ?? (() => {})}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((v) => !v)}
        baseBranch={baseBranch}
        onBaseBranchChange={setBaseBranch}
      />
    );

  return (
    <div className="dv-workspace flex flex-col h-full min-h-0 w-full bg-background">
      {layout.visible.branch && (
        <div className="dv-branch-bar shrink-0 flex items-center gap-2">
          <div className="flex-1 min-w-0">{branchSlot}</div>
          <div className="pr-3 shrink-0">
            <PanelToolbar workspace={workspace} />
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        <DockviewReact
          components={COMPONENTS}
          theme={themeAbyssSpaced}
          onReady={onReady}
          disableFloatingGroups={false}
          singleTabMode="default"
        />
      </div>
    </div>
  );
}
