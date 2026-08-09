/**
 * Remove groups that hold no panels from a saved dockview layout.
 *
 * An empty group renders as a blank region with no tab and no content — the
 * "phantom panel" in the Code surface. One real layout, read out of the user's
 * profile, looked like this:
 *
 *   group 1  views=[]     <- phantom
 *   group 3  views=[]     <- phantom
 *   group 5  views=[chat]
 *   group 2  views=[viewer]
 *   group 4  views=[tree]
 *
 * Three panels, five groups. Closing a panel can leave its group behind, and
 * `toJSON` persists whatever is there; `fromJSON` then restores it on every
 * launch, so one stray close is permanent until the layout is reset. The Panels
 * menu counts PANELS, so it shows three ticks while four regions are on screen —
 * which is why it reads as a ghost rather than as something the user did.
 *
 * Pruning on read AND on write is deliberate: on write to stop new ones being
 * stored, and on read because every profile already carrying them would
 * otherwise need a manual Reset layout.
 *
 * Structural only — this never invents or reorders panels. A layout it cannot
 * understand is returned untouched, because a wrong repair is worse than a
 * blank panel.
 */

interface Leaf {
  type?: string;
  data?: { id?: string; views?: unknown[] };
  size?: number;
}
interface Branch {
  type?: string;
  data?: unknown[];
  size?: number;
}
type Node = Leaf | Branch;

const isBranch = (n: Node): n is Branch => (n as Branch)?.type === 'branch';
const isEmptyLeaf = (n: Node): boolean =>
  !isBranch(n) && Array.isArray((n as Leaf)?.data?.views) && (n as Leaf).data!.views!.length === 0;

/**
 * @returns the node with empty leaves removed, or `null` when nothing is left —
 *   which the caller treats as "fall back to the default layout" rather than
 *   rendering an empty workspace.
 */
function pruneNode(node: Node): Node | null {
  if (!node || typeof node !== 'object') return null;

  if (isBranch(node)) {
    const kept = (node.data ?? [])
      .map((c) => pruneNode(c as Node))
      .filter((c): c is Node => c !== null);
    if (kept.length === 0) return null;
    // A branch with one child is a redundant nesting level once its sibling has
    // gone. Collapsing keeps the tree the shape dockview would have built, and
    // avoids a column that cannot be resized because it has nothing to resize
    // against.
    if (kept.length === 1) return kept[0];
    return { ...node, data: kept };
  }

  return isEmptyLeaf(node) ? null : node;
}

export interface PruneResult {
  layout: unknown;
  /** How many empty groups were dropped — 0 means the layout was already clean. */
  removed: number;
}

/** Count the empty groups in a layout, without changing it. */
export function countEmptyGroups(layout: unknown): number {
  let n = 0;
  const visit = (node: Node) => {
    if (!node || typeof node !== 'object') return;
    if (isBranch(node)) (node.data ?? []).forEach((c) => visit(c as Node));
    else if (isEmptyLeaf(node)) n++;
  };
  const root = (layout as { grid?: { root?: Node } })?.grid?.root;
  if (root) visit(root);
  return n;
}

export function pruneEmptyGroups(layout: unknown): PruneResult {
  const l = layout as { grid?: { root?: Node } } | null;
  const root = l?.grid?.root;
  if (!root) return { layout, removed: 0 };

  const removed = countEmptyGroups(layout);
  if (removed === 0) return { layout, removed: 0 };

  const pruned = pruneNode(root);
  // Everything was empty: there is no meaningful layout to restore, so let the
  // caller build the default rather than showing a blank workspace.
  if (!pruned) return { layout: null, removed };

  return {
    layout: { ...(l as object), grid: { ...(l!.grid as object), root: pruned } },
    removed,
  };
}
