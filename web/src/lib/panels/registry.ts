/**
 * Every panel any surface can show, declared in one place.
 *
 * WHY THIS EXISTS — three bugs in one session, none of them bugs in the feature
 * they appeared in:
 *
 *   1. The goal panel rendered TWICE, side by side with itself.
 *   2. It was mounted in a sidebar branch the empty state never renders, so a
 *      working, tested feature was unreachable. The report was "there is no
 *      option to pursue goal".
 *   3. Adding it to Code threw `invalid location` from `addPanel` and took the
 *      whole surface down — and that surface's only feedback about the failure
 *      depended on the panel that had just failed to open.
 *
 * Not one is about goals. Each is the same missing answer: *where may a panel
 * live, and who decides whether it is open?* Today there are as many answers as
 * there are panels, so each new panel re-earns the same three bugs.
 *
 * This is the third time this repo has learned this. `resolveSendRoute` exists
 * because four surfaces each resolved their own model and one forgot;
 * `single-setup-point.test.ts` exists because there were four places to pick
 * one. Both needed a test derived from source before they held, which is why
 * `panel-coverage.test.ts` sits beside this file rather than a comment asking
 * people to remember.
 *
 * SCOPE. This declares WHERE panels may live and WHAT mounts them. It does not
 * own their internals, their data, or their open/closed state — Code keeps its
 * dockview layout, Cowork keeps its rail. Moving the declaration is step 1 of
 * DR-20; moving behaviour is not, and doing both at once is how a refactor
 * eats a week.
 */

export type SurfaceId = 'chat' | 'cowork' | 'code' | 'browser' | 'assistant';

/**
 * How a panel gets on screen. The distinction is load-bearing: `dock` panels
 * are addressable by `addPanel` and can be closed and re-added by the user;
 * `rail` panels are rendered by their surface in a fixed column.
 */
export type PanelHost = 'dock' | 'rail';

export interface PanelDef {
  id: string;
  /** Human label — the dockview tab or the rail card heading. */
  title: string;
  /** Surfaces ALLOWED to host it. A surface not listed must not mount it. */
  surfaces: SurfaceId[];
  host: PanelHost;
  /**
   * The component identifier the coverage test looks for in the surface's
   * source. For `dock` panels this is the key in workspace-layout's
   * `COMPONENTS` map; for `rail` panels it is the JSX element or its `label`.
   */
  mount: string;
  /**
   * Open without the user asking. `false` means it appears only when added —
   * DR-20 D-3: chrome should be predictable rather than clever, and a panel the
   * user closed stays closed.
   */
  defaultOpen: boolean;
}

export const PANELS: readonly PanelDef[] = [
  /* ── Code: the dockview surface ─────────────────────────────────────── */
  {
    id: 'chat',
    title: 'Chat',
    surfaces: ['code'],
    host: 'dock',
    mount: 'chat',
    // Always available; its tab renders with the close action hidden.
    defaultOpen: true,
  },
  {
    id: 'tree',
    title: 'Files',
    surfaces: ['code'],
    host: 'dock',
    mount: 'tree',
    defaultOpen: true,
  },
  {
    id: 'viewer',
    title: 'Editor',
    surfaces: ['code'],
    host: 'dock',
    mount: 'viewer',
    defaultOpen: true,
  },
  {
    id: 'terminal',
    title: 'Terminal',
    surfaces: ['code'],
    host: 'dock',
    mount: 'terminal',
    defaultOpen: false,
  },
  {
    id: 'file',
    title: 'File',
    surfaces: ['code'],
    host: 'dock',
    mount: 'file',
    // Dynamic: one panel per opened file, so there is nothing to open by default.
    defaultOpen: false,
  },
  {
    id: 'diff',
    title: 'Diff',
    surfaces: ['code'],
    host: 'dock',
    mount: 'diff',
    defaultOpen: false,
  },

  /* ── The goal panel, which is the reason this file exists ───────────── */
  {
    id: 'goal',
    title: 'Goal',
    /*
     * BOTH surfaces, and that is the point. A goal run is meaningless on a
     * surface that cannot show it, and the failure is silent: the run works and
     * nobody can see it. On Code it is a dock panel opened on demand — a
     * deliberate non-member of `PanelSlot`, because adding a slot would rewrite
     * the persisted `Record<PanelSlot, RegionId>` and cost every user their
     * layout. On Cowork it lives in the rail.
     */
    surfaces: ['code', 'cowork'],
    host: 'dock',
    mount: 'goal',
    defaultOpen: false,
  },
  {
    id: 'goal-status',
    title: 'Goal',
    surfaces: ['cowork'],
    host: 'rail',
    mount: 'GoalRunStatus',
    defaultOpen: true,
  },

  /* ── Cowork: the rail ───────────────────────────────────────────────── */
  {
    id: 'context',
    title: 'Context',
    surfaces: ['cowork'],
    host: 'rail',
    mount: 'Context',
    defaultOpen: true,
  },
  {
    id: 'artifacts',
    title: 'Artifacts',
    surfaces: ['cowork'],
    host: 'rail',
    mount: 'Artifacts',
    defaultOpen: true,
  },
  {
    id: 'search-results',
    title: 'Search results',
    surfaces: ['cowork'],
    host: 'rail',
    mount: 'SearchResultsCard',
    /*
     * Appears only when a search has happened — a surviving heuristic, and
     * DR-20 D-3 argues these should become explicit. Left as-is here because
     * this step moves the declaration, not the behaviour.
     */
    defaultOpen: false,
  },
  {
    id: 'canvases',
    title: 'Canvases',
    surfaces: ['cowork'],
    host: 'rail',
    mount: 'CoworkCanvasToggle',
    defaultOpen: false,
  },
  {
    id: 'task-metrics',
    title: 'Task metrics',
    surfaces: ['cowork'],
    host: 'rail',
    mount: 'TaskMetricsCard',
    defaultOpen: false,
  },
  {
    id: 'preview',
    title: 'Preview',
    surfaces: ['cowork'],
    host: 'rail',
    mount: 'onPreviewClick',
    defaultOpen: false,
  },
] as const;

/**
 * The rail's contents for a surface, IN RENDER ORDER.
 *
 * Order lives here rather than in JSX because it is a product decision — the
 * goal dashboard above Context and Artifacts, spend and preview at the bottom —
 * and a decision buried in a 2,000-line component is a decision nobody can find
 * to change.
 */
export function railPanels(surface: SurfaceId): PanelDef[] {
  return panelsForSurface(surface).filter((p) => p.host === 'rail');
}

/** Panels a surface is allowed to host. */
export function panelsForSurface(surface: SurfaceId): PanelDef[] {
  return PANELS.filter((p) => p.surfaces.includes(surface));
}

/** Is this panel allowed here? The question `addPanel` never asked. */
export function isPanelAllowed(id: string, surface: SurfaceId): boolean {
  const def = PANELS.find((p) => p.id === id);
  return !!def && def.surfaces.includes(surface);
}

export function getPanel(id: string): PanelDef | undefined {
  return PANELS.find((p) => p.id === id);
}

/**
 * The title dockview shows on a panel's tab.
 *
 * Every `addPanel` call used to carry its own string literal — "Files" in two
 * places, "Editor" in three — so renaming a panel meant finding all of them and
 * a miss produced two tabs for one concept. Falls back to the id rather than
 * throwing: a wrong-looking tab is a better failure than a dead Code surface,
 * which is the trade `addPanel` throwing `invalid location` already taught us.
 */
export function panelTitle(id: string): string {
  return getPanel(id)?.title ?? id;
}
