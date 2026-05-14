"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DockviewReact,
  themeAbyssSpaced,
  themeLightSpaced,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewTheme,
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

// Defensive param read — first render may not have updateParameters run yet.
function safeCtx(p: Partial<WorkspaceContext> | undefined): WorkspaceContext {
  return {
    workspace: p?.workspace ?? null,
    setVisible: p?.setVisible ?? (() => {}),
    historyOpen: p?.historyOpen ?? false,
    setHistoryOpen: p?.setHistoryOpen ?? (() => {}),
    baseBranch: p?.baseBranch ?? null,
    setBaseBranch: p?.setBaseBranch ?? (() => {}),
    onFolderChange: p?.onFolderChange ?? (() => {}),
    slots: p?.slots ?? {},
  };
}

function ChatRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { slots } = safeCtx(props.params);
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
  const { workspace, slots } = safeCtx(props.params);
  return <div className="dv-region-body">{slots.tree ?? <FileTree workspace={workspace} />}</div>;
}

function ViewerRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { workspace, historyOpen, setHistoryOpen, slots } = safeCtx(props.params);
  if (slots.viewer) return <div className="dv-region-body">{slots.viewer}</div>;
  // Editor "home" tab — shown when no file is open. Click a file in the
  // tree to spawn a `file:` tab; that tab takes over rendering.
  return (
    <div className="dv-region-body flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        {historyOpen
          ? <GitHistory workspace={workspace} onClose={() => setHistoryOpen(false)} />
          : <ViewerPane workspace={workspace} />}
      </div>
    </div>
  );
}

/** File viewer panel — one per open file. dockview owns the tab; we
 *  fetch + render the contents via the shared file-renderers. */
interface FilePanelParams extends WorkspaceContext {
  filePath: string;
}
function FileRegion(props: IDockviewPanelProps<FilePanelParams>) {
  // Important: don't run params through safeCtx — it'd drop filePath
  // (the shim only knows WorkspaceContext fields). Read directly.
  const params = (props.params ?? {}) as Partial<FilePanelParams>;
  const workspace = params.workspace ?? null;
  const filePath = params.filePath;
  if (!workspace || !filePath) {
    return (
      <div className="dv-region-body p-4 text-xs text-muted-foreground">
        No file path.
      </div>
    );
  }
  return (
    <div className="dv-region-body">
      <ViewerPane workspace={workspace} forcedPath={filePath} />
    </div>
  );
}

function TerminalRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { workspace, slots } = safeCtx(props.params);
  if (slots.terminal) return <div className="dv-region-body">{slots.terminal}</div>;
  // sessionKey = panel id → each terminal panel gets its own PTY (without
  // this, two `terminal-*` panels share one shell and show identical output).
  return (
    <div className="dv-region-body">
      {workspace ? (
        <TerminalPanel workspace={workspace} sessionKey={props.api.id} visible />
      ) : (
        <div className="p-4 text-xs text-muted-foreground">Open a folder first.</div>
      )}
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
  // Same as FileRegion — read params directly so filePath / fromRef /
  // toRef survive the dockview panel-mount race.
  const params = (props.params ?? {}) as Partial<DiffPanelParams>;
  const workspace = params.workspace ?? null;
  const filePath = params.filePath ?? "";
  if (!workspace || !filePath) {
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
        fromRef={params.fromRef}
        toRef={params.toRef}
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
  file: FileRegion,
} as const;

// Default layout is built via `api.addPanel` (not fromJSON) so params are
// wired at creation — see `onReady` below.

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

/**
 * Watches <html> classList for `.dark` / `.emma` and returns the matching
 * dockview theme. Reactive — re-renders when the user flips Quarry's theme.
 */
function useDockviewTheme(): DockviewTheme {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const compute = () => setIsDark(html.classList.contains("dark"));
    compute();
    const obs = new MutationObserver(compute);
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark ? themeAbyssSpaced : themeLightSpaced;
}

export function WorkspaceLayout({ workspace, onFolderChange, slots = {} }: WorkspaceLayoutProps) {
  const { layout } = useCodeWorkspace(workspace);
  const apiRef = useRef<DockviewApi | null>(null);
  const dockviewTheme = useDockviewTheme();

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

    // Build the default layout panel-by-panel so each panel's `params`
    // is set at creation time (fromJSON skips params).
    const paramsObj = ctx as unknown as Record<string, unknown>;
    try {
      const chatPanel = event.api.addPanel({
        id: "chat",
        component: "chat",
        title: "Chat",
        params: paramsObj,
      });
      event.api.addPanel({
        id: "viewer",
        component: "viewer",
        title: "Editor",
        params: paramsObj,
        position: { referencePanel: chatPanel.id, direction: "right" },
      });
      event.api.addPanel({
        id: "tree",
        component: "tree",
        title: "Files",
        params: paramsObj,
        position: { referencePanel: "viewer", direction: "left" },
      });
    } catch (err) {
      console.error("[ide] default-layout build failed", err);
    }

    // Window-scoped API so the file tree / branch header / toolbar can
    // request panels without prop drilling.

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

    /** Open a file as a tab in the editor group. Dedupes by path — clicking
     *  a file that's already open just focuses the existing tab. */
    (window as unknown as Record<string, unknown>).__ideOpenFile = (filePath: string) => {
      const id = `file:${filePath}`;
      const existing = event.api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }
      event.api.addPanel({
        id,
        component: "file",
        title: filePath.split("/").pop() ?? filePath,
        params: { ...ctx, filePath } as unknown as Record<string, unknown>,
        position: { referencePanel: "viewer", direction: "within" },
      });
    };

    /** Open a new terminal panel. Each instance gets a unique id so
     *  multiple terminals can coexist as tabs. */
    let nextTerminalIndex = 1;
    (window as unknown as Record<string, unknown>).__ideOpenTerminal = () => {
      const id = `terminal-${Date.now()}`;
      const ref = event.api.getPanel("viewer") ? "viewer" : event.api.panels[0]?.id;
      event.api.addPanel({
        id,
        component: "terminal",
        title: `Terminal ${nextTerminalIndex++}`,
        params: ctx as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "below" } : undefined,
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
          theme={dockviewTheme}
          onReady={onReady}
          disableFloatingGroups={false}
          singleTabMode="default"
        />
      </div>
    </div>
  );
}
