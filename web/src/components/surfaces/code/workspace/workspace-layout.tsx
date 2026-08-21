"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GoalPanel } from "@/components/harness/goal-panel";
import {
  DockviewReact,
  DockviewDefaultTab,
  themeAbyssSpaced,
  themeLightSpaced,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type DockviewTheme,
} from "dockview";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { pruneEmptyGroups } from "@/lib/code-workspace/prune-layout";
import { useIsDarkTheme } from "@/hooks/use-dark-theme";
import { PanelToolbar } from "./panel-toolbar";
import { BranchHeader } from "./branch-header";
import { GitHistory } from "./git-history";
import { FileTree } from "./file-tree";
import { ViewerPane } from "./viewer-pane";
import { DiffViewer } from "./diff-viewer";
import { StatusBar } from "./status-bar";
import { KeybindHelp } from "./keybind-help";
import { XtermErrorBoundary } from "./xterm-error-boundary";
import dynamic from "next/dynamic";
import "dockview/dist/styles/dockview.css";
import "./workspace-dockview.css";
import { panelTitle } from "@/lib/panels/registry";

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
  /** Identifies a long-running goal run. Runs are per-conversation. */
  chatId: string;
  /** Slot overrides from the parent (e.g. real chat composer from code-surface). */
  slots: Partial<Record<"chat" | "tree" | "tabs" | "viewer" | "terminal" | "branch", ReactNode>>;
  /**
   * The preview panel's content, supplied by the surface.
   *
   * Its own field rather than a member of `slots` above, because that Record is
   * keyed by `PanelSlot` — the type behind the persisted
   * `Record<PanelSlot, RegionId>` whose migration discards what it does not
   * recognise. Adding `preview` there would cost every user their layout, which
   * is the same reason the goal panel opens on demand.
   */
  previewSlot?: ReactNode;
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
    chatId: p?.chatId ?? '',
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
  // ErrorBoundary swallows xterm's harmless first-render "dimensions" throw.
  return (
    <div className="dv-region-body">
      {workspace ? (
        <XtermErrorBoundary>
          <TerminalPanel workspace={workspace} sessionKey={props.api.id} visible />
        </XtermErrorBoundary>
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

/**
 * A long-running goal run.
 *
 * A DYNAMIC panel, like `file:` and `diff:`, rather than a `PanelSlot`. A slot
 * would have to be added to `Record<PanelSlot, RegionId>` in the persisted
 * layout, and that store's `migrate` discards `byWorkspace` wholesale — so
 * adding a panel would reset every user's pane arrangement as a side effect.
 * On-demand is also the better behaviour: the panel opens itself when a goal
 * exists and is absent when there is nothing to show.
 */
/**
 * The preview, as a real dockview panel.
 *
 * It used to render OUTSIDE dockview entirely — a sibling overlay floating on
 * top of the chat panel, with no tab, so it could not be docked, dragged or
 * placed like every other region. That was a shortcut: the panel already
 * existed, and making it reachable from the Panels menu was less work than
 * making it a panel. It looked wrong immediately, because everything beside it
 * IS a panel.
 *
 * The content comes from the surface via `slots.preview`, the same way chat,
 * tree and terminal do — the webview belongs to the surface, which owns its
 * lifecycle and hands the ref to the agent.
 */
function PreviewRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const ctx = safeCtx(props.params);
  return <div className="dv-region-body">{ctx.previewSlot ?? null}</div>;
}

function GoalRegion(props: IDockviewPanelProps<WorkspaceContext>) {
  const { workspace, chatId } = safeCtx(props.params);
  return (
    <div className="dv-region-body overflow-auto">
      <GoalPanel conversationId={chatId} workingDir={workspace} surfaceId="code" />
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
  goal: GoalRegion,
  preview: PreviewRegion,
} as const;

// Chat is always available — render its tab with the close action hidden.
function ChatTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} hideClose />;
}
const TAB_COMPONENTS = {
  "chat-tab": ChatTab,
};

// Default layout is built via `api.addPanel` (not fromJSON) so params are
// wired at creation — see `onReady` below.

// ────────────────────────────────────────────────────────────────────────

interface WorkspaceLayoutProps {
  workspace: string | null;
  /** Conversation the goal run belongs to. */
  chatId: string;
  onFolderChange?: (folder: string | null) => void;
  slots?: Partial<{
    branch: ReactNode;
    tree: ReactNode;
    tabs: ReactNode;
    viewer: ReactNode;
    terminal: ReactNode;
    chat: ReactNode;
  }>;
  /** Content for the on-demand preview panel. */
  previewSlot?: ReactNode;
}

/**
 * Watches <html> classList and returns the matching dockview theme. Reactive —
 * re-renders when the user flips the app theme.
 *
 * Asks the theme registry rather than testing for `.dark` literally: Max is a
 * dark theme with its own class, and the literal test would have handed it the
 * LIGHT editor theme.
 */
function useDockviewTheme(): DockviewTheme {
  return useIsDarkTheme() ? themeAbyssSpaced : themeLightSpaced;
}

export function WorkspaceLayout({ workspace, chatId, onFolderChange, slots = {} }: WorkspaceLayoutProps) {
  const { layout, setDockviewLayout, setVisible } = useCodeWorkspace(workspace);
  const apiRef = useRef<DockviewApi | null>(null);
  const dockviewTheme = useDockviewTheme();
  // Snapshot saving is debounced — dockview fires lots of micro-events
  // during a single drag (sash, panel-move, focus, etc.).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    chatId,
    slots,
  };

  function onReady(event: DockviewReadyEvent) {
    apiRef.current = event.api;

    // Restore saved snapshot if we have one. fromJSON discards params,
    // so we stamp them back onto every panel afterwards.
    const paramsObj = ctx as unknown as Record<string, unknown>;
    /**
     * Prune before restoring. A saved layout can carry groups with no panels in
     * them — one real profile had two — and dockview renders each as a blank
     * region with no tab. `fromJSON` would faithfully bring them back on every
     * launch, so a single stray panel-close became permanent.
     */
    const pruned = pruneEmptyGroups(layout.dockviewLayout);
    if (pruned.removed > 0) {
      console.log(`[ide] dropped ${pruned.removed} empty panel group(s) from the saved layout`);
    }
    const saved = pruned.layout;
    let restored = false;
    if (saved && typeof saved === "object") {
      try {
        event.api.fromJSON(saved as never);
        restored = true;
        for (const panel of event.api.panels) {
          // Carry forward any per-panel params we know about (filePath /
          // refs for file + diff tabs are baked into their id so they
          // can be re-derived).
          const id = panel.api.id;
          let extra: Record<string, unknown> = {};
          if (id.startsWith("file:")) {
            extra = { filePath: id.slice("file:".length) };
          } else if (id.startsWith("diff:")) {
            extra = { filePath: id.slice("diff:".length) };
          }
          panel.api.updateParameters({ ...paramsObj, ...extra });
        }
      } catch (err) {
        console.warn("[ide] failed to restore saved layout — falling back to default", err);
        restored = false;
      }
    }
    if (!restored) {
      try {
        const chatPanel = event.api.addPanel({
          id: "chat",
          component: "chat",
          tabComponent: "chat-tab",
          title: panelTitle("chat"),
          params: paramsObj,
        });
        event.api.addPanel({
          id: "viewer",
          component: "viewer",
          title: panelTitle("viewer"),
          params: paramsObj,
          position: { referencePanel: chatPanel.id, direction: "right" },
        });
        event.api.addPanel({
          id: "tree",
          component: "tree",
          title: panelTitle("tree"),
          params: paramsObj,
          position: { referencePanel: "viewer", direction: "left" },
        });
      } catch (err) {
        console.error("[ide] default-layout build failed", err);
      }
    }

    // Persist on any layout change — panel move, resize, add, remove,
    // activeTab change. Debounce so a single drag doesn't fire 30 writes.
    const persist = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          // Strip non-serialisable params (JSX slots, fns, refs) before
          // the Zustand persist middleware tries to JSON.stringify the
          // whole store. dockview will re-receive params on restore via
          // updateParameters in onReady.
          // Pruned on the way out too, so a layout saved while a group happened
        // to be empty does not store the phantom in the first place.
        const raw = pruneEmptyGroups(event.api.toJSON() as unknown).layout;
          const snapshot = raw as {
            panels?: Record<string, { params?: unknown } & Record<string, unknown>>;
          };
          if (snapshot.panels) {
            for (const id of Object.keys(snapshot.panels)) {
              const p = snapshot.panels[id];
              if (p && typeof p === "object" && "params" in p) {
                delete p.params;
              }
            }
          }
          setDockviewLayout(snapshot);
        } catch (err) {
          console.warn("[ide] toJSON snapshot failed", err);
        }
      }, 300);
    };
    event.api.onDidLayoutChange(persist);
    event.api.onDidAddPanel(persist);
    event.api.onDidRemovePanel(persist);
    event.api.onDidActivePanelChange(persist);

    // Mirror tab-close → store visibility, so the Panels dropdown
    // reflects what's actually mounted. Without this, closing a panel
    // via its X leaves `visible: true` in the store and the menu still
    // shows the check — clicking the menu entry then no-ops.
    event.api.onDidRemovePanel((panel) => {
      const id = panel.api.id;
      if (id === "viewer") setVisible("viewer", false);
      else if (id === "terminal") setVisible("terminal", false);
      else if (id === "tree") setVisible("tree", false);
      else if (id === "chat") setVisible("chat", false);
    });
    event.api.onDidAddPanel((panel) => {
      const id = panel.api.id;
      if (id === "viewer") setVisible("viewer", true);
      else if (id === "terminal") setVisible("terminal", true);
      else if (id === "tree") setVisible("tree", true);
      else if (id === "chat") setVisible("chat", true);
    });

    // Window-scoped API so the file tree / branch header / toolbar can
    // request panels without prop drilling.

    /**
     * Pick a safe referencePanel for addPanel — the user can close or drag
     * away `viewer`, so walk a fallback chain instead of hard-referencing it.
     */
    function editorRef(): string | undefined {
      const api = event.api;
      if (api.getPanel("viewer")) return "viewer";
      const filePanel = api.panels.find((p) => p.api.id.startsWith("file:"));
      if (filePanel) return filePanel.api.id;
      const diffPanel = api.panels.find((p) => p.api.id.startsWith("diff:"));
      if (diffPanel) return diffPanel.api.id;
      const active = api.activePanel;
      if (active) return active.api.id;
      return api.panels[0]?.api.id;
    }

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
      const fromRef = opts?.fromRef ?? ctx.baseBranch ?? undefined;
      const toRef = opts?.toRef;
      const ref = editorRef();
      event.api.addPanel({
        id,
        component: "diff",
        title: filePath.split("/").pop() ?? filePath,
        params: { ...ctx, filePath, fromRef, toRef } as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "within" } : undefined,
      });
    };

    /*
     * Open the goal panel. Same shape as the file and diff openers above, and
     * idempotent — calling it while the panel is open just focuses it, which is
     * what makes the auto-open effect safe to run on every status poll.
     */
    (window as unknown as Record<string, unknown>).__ideOpenGoal = () => {
      const id = "goal";
      const existing = event.api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }
      /*
       * Placed defensively.
       *
       * dockview threw `invalid location` here on a real run: a reference panel
       * that `editorRef()` believes exists is not always somewhere dockview will
       * accept a panel — a floating group, or one mid-teardown, is enough. The
       * file and diff openers get away with it because they are called from a
       * click on the tree, when the editor group is definitely settled; this one
       * fires straight after a send.
       *
       * A panel placed in the wrong group is a cosmetic problem. A throw here
       * takes down the whole surface, which is what happened.
       */
      const spec = {
        id,
        component: "goal",
        title: "Goal",
        params: { ...ctx } as unknown as Record<string, unknown>,
      };
      const ref = editorRef();
      try {
        event.api.addPanel(
          ref ? { ...spec, position: { referencePanel: ref, direction: "within" as const } } : spec,
        );
      } catch {
        try {
          event.api.addPanel(spec);
        } catch (e) {
          // Nothing left to try. The run is unaffected — it lives on the server —
          // so log and let the inline status carry the news instead.
          console.warn("[harness] could not open the goal panel:", e);
        }
      }
    };

    /*
     * Open the preview as a real panel.
     *
     * Same shape and the same defensive placement as the goal opener above —
     * dockview threw `invalid location` there on a real run, and a panel in the
     * wrong group is cosmetic where a throw takes down the surface.
     *
     * It lands BESIDE the editor rather than within it: a preview is something
     * you watch while working on something else, so stacking it as a tab over
     * the file you are editing is the wrong default. Users can drag it anywhere
     * afterwards, which is the entire point of making it a panel.
     */
    (window as unknown as Record<string, unknown>).__ideOpenPreviewPanel = () => {
      const id = "preview";
      const existing = event.api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }
      const spec = {
        id,
        component: "preview",
        title: "Preview",
        params: { ...ctx } as unknown as Record<string, unknown>,
      };
      const ref = editorRef();
      try {
        event.api.addPanel(
          ref ? { ...spec, position: { referencePanel: ref, direction: "below" as const } } : spec,
        );
      } catch {
        try {
          event.api.addPanel(spec);
        } catch (e) {
          console.warn("[preview] could not open the preview panel:", e);
        }
      }
    };

    (window as unknown as Record<string, unknown>).__ideOpenFile = (filePath: string) => {
      const id = `file:${filePath}`;
      const existing = event.api.getPanel(id);
      if (existing) {
        existing.api.setActive();
        return;
      }
      const ref = editorRef();
      event.api.addPanel({
        id,
        component: "file",
        title: filePath.split("/").pop() ?? filePath,
        params: { ...ctx, filePath } as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "within" } : undefined,
      });
    };

    let nextTerminalIndex = 1;
    (window as unknown as Record<string, unknown>).__ideOpenTerminal = () => {
      const id = `terminal-${Date.now()}`;
      const ref = editorRef();
      event.api.addPanel({
        id,
        component: "terminal",
        title: `Terminal ${nextTerminalIndex++}`,
        params: ctx as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "below" } : undefined,
      });
    };
  }

  // Push ctx changes (historyOpen, slots, baseBranch…) to every panel.
  // updateParameters MERGES rather than replaces, so existing per-panel
  // fields (filePath / fromRef / toRef on file + diff tabs) survive.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    for (const panel of api.panels) {
      panel.api.updateParameters(ctx as unknown as Record<string, unknown>);
    }
    // For diff tabs that weren't given an explicit fromRef, also push
    // the new baseBranch so they can re-fetch when the picker changes.
    for (const panel of api.panels) {
      if (!panel.api.id.startsWith("diff:")) continue;
      panel.api.updateParameters({ fromRef: baseBranch ?? undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, slots, workspace, baseBranch]);

  // Add / remove the terminal panel reactively
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel("terminal");
    if (layout.visible.terminal && !existing) {
      // Same fallback chain as __ideOpenTerminal — viewer may not exist.
      const viewerExists = api.getPanel("viewer");
      const fileLike = api.panels.find(
        (p) => p.api.id.startsWith("file:") || p.api.id.startsWith("diff:"),
      );
      const ref = viewerExists ? "viewer" : fileLike?.api.id ?? api.activePanel?.api.id ?? api.panels[0]?.api.id;
      api.addPanel({
        id: "terminal",
        component: "terminal",
        title: panelTitle("terminal"),
        params: ctx as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "below" } : undefined,
      });
    } else if (!layout.visible.terminal && existing) {
      existing.api.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.visible.terminal]);

  // Add / remove the editor (viewer) panel reactively
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel("viewer");
    if (layout.visible.viewer && !existing) {
      // Anchor next to the chat panel if possible, else the first panel.
      const ref = api.getPanel("chat") ? "chat" : api.panels[0]?.api.id;
      api.addPanel({
        id: "viewer",
        component: "viewer",
        title: panelTitle("viewer"),
        params: ctx as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "right" } : undefined,
      });
    } else if (!layout.visible.viewer && existing) {
      existing.api.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.visible.viewer]);

  // Add / remove the Files (tree) panel reactively
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel("tree");
    if (layout.visible.tree && !existing) {
      // Slot next to chat → otherwise next to whatever's first.
      const ref = api.getPanel("chat") ? "chat" : api.panels[0]?.api.id;
      api.addPanel({
        id: "tree",
        component: "tree",
        title: panelTitle("tree"),
        params: ctx as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "right" } : undefined,
      });
    } else if (!layout.visible.tree && existing) {
      existing.api.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.visible.tree]);

  // Add / remove the Chat panel reactively. (The chat tab has no close X —
  // its only toggle path is the Panels dropdown.)
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel("chat");
    if (layout.visible.chat && !existing) {
      const ref = api.panels[0]?.api.id;
      api.addPanel({
        id: "chat",
        component: "chat",
        tabComponent: "chat-tab",
        title: panelTitle("chat"),
        params: ctx as unknown as Record<string, unknown>,
        position: ref ? { referencePanel: ref, direction: "left" } : undefined,
      });
    } else if (!layout.visible.chat && existing) {
      existing.api.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.visible.chat]);

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
          tabComponents={TAB_COMPONENTS}
          theme={dockviewTheme}
          onReady={onReady}
          disableFloatingGroups={false}
          singleTabMode="default"
        />
      </div>
      <StatusBar workspace={workspace} />
      <KeybindHelp />
    </div>
  );
}
