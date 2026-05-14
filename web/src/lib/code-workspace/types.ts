/**
 * Shared types for the Code surface IDE workspace.
 *
 * Wave 1 declares all interfaces; Wave 2 fills the implementations.
 */

/** Named slots in the workspace layout. */
export type PanelSlot = 'tree' | 'tabs' | 'viewer' | 'terminal' | 'chat' | 'branch';

/** A region in the workspace grid — may hold one or many stacked panels. */
export type RegionId = 'left' | 'center-top' | 'center-bottom' | 'right' | 'top';

/** Layout state persisted per workspace path. */
export interface WorkspaceLayout {
  /** Panel ID → assigned region (drag-to-rearrange writes here). */
  slotAssignments: Record<PanelSlot, RegionId>;
  /** Per-panel visibility (toggle buttons + keybinds). */
  visible: Record<PanelSlot, boolean>;
  /** Region sizes as percentages. */
  sizes: {
    /** Chat (left hero) width as %. */
    chatWidth: number;
    /** File tree column width as %. */
    leftWidth: number;
    /** Legacy right-rail width — kept for back-compat. */
    rightWidth: number;
    /** Terminal panel height as % of the centre column. */
    terminalHeight: number;
  };
  /** Open tabs in the viewer region. */
  openTabs: WorkspaceTab[];
  /** Tab ID currently active. */
  activeTabId: string | null;
}

export interface WorkspaceTab {
  id: string;
  kind: 'file' | 'diff';
  path: string;
  /** For diff tabs: ref to compare against, e.g. 'HEAD' or branch name. */
  diffRef?: string;
  /** Pinned tabs survive single-click navigation. */
  pinned: boolean;
}

/** File-tree node (lazy-loaded children). */
export interface FsNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FsNode[];
  /** Git status flags from `git status --porcelain` if known. */
  gitStatus?: GitFileStatus;
}

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'staged';

/** Git status summary for a workspace. */
export interface GitStatus {
  branch: string;
  baseBranch: string | null;
  ahead: number;
  behind: number;
  files: Array<{
    path: string;
    status: GitFileStatus;
    /** +N inserted lines, −N deleted (best-effort, from `git diff --numstat`). */
    additions?: number;
    deletions?: number;
  }>;
}

/** A single commit in the history view. */
export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
  body?: string;
}

/** A single line in a `git blame` result. */
export interface BlameLine {
  hash: string;
  author: string;
  date: string;
  lineNumber: number;
  content: string;
}

/** PTY session opened for a code conversation. */
export interface PtySession {
  id: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
}

/** Default layout — applied when a workspace is opened for the first time. */
export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  slotAssignments: {
    branch: 'top',
    chat: 'left',         // hero, leftmost
    tree: 'center-top',   // file tree sits to the right of chat
    tabs: 'center-top',
    viewer: 'center-top',
    terminal: 'center-bottom',
  },
  visible: {
    branch: true,
    tree: true,
    tabs: true,
    viewer: true,
    terminal: false, // off by default; user opens via toggle
    chat: true,
  },
  sizes: {
    chatWidth: 40,      // chat dominates the left half
    leftWidth: 18,      // file tree column to the right of chat
    rightWidth: 30,     // legacy — kept for back-compat
    terminalHeight: 25,
  },
  openTabs: [],
  activeTabId: null,
};
