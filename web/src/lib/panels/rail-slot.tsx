import type { ReactNode } from 'react';
import { isPanelAllowed, type SurfaceId } from './registry';

/**
 * A rail card, declared.
 *
 * WHY A WRAPPER RATHER THAN MOVING THE JSX. The rail's cards were a flat run of
 * markup 500 lines into a 2,000-line component, and nothing enumerated them —
 * which is not a theoretical problem: the registry was first written from a
 * read of that file and caught THREE OF SEVEN. Canvases, Task metrics and
 * Preview were missed outright, and the drift test did not notice because it
 * only checked dockview's component map.
 *
 * The obvious fix — hoist every card into a data structure — was tried and
 * reverted. Restructuring that much JSX by hand is how a subtle rendering bug
 * gets in, and the rail is not where you want to find one.
 *
 * So the cards stay exactly where they are and each declares itself. That buys
 * the two properties that actually mattered:
 *
 *   1. The registry is LOAD-BEARING. Remove an entry and the card stops
 *      rendering, rather than the entry being a comment that drifts.
 *   2. The rail is ENUMERABLE. `panel-coverage.test.ts` reads the `id`s out of
 *      source and requires them to match the registry in both directions, so a
 *      card added without an entry fails, and an entry with no card fails.
 *
 * What it deliberately does NOT do is own order — that is still JSX. DR-20
 * step 4 (the rail becomes tabs) is where order moves, and doing it here would
 * be the same over-reach that got reverted.
 */
export function RailSlot({
  surface,
  id,
  active,
  children,
}: {
  surface: SurfaceId;
  id: string;
  /**
   * The rail's selected tab. Omit for a rail that stacks everything.
   *
   * Passing it here rather than moving the cards into a data structure is the
   * same trade as above: the JSX stays put and one prop decides whether it
   * renders. The alternative was a rewrite that produced seven type errors.
   */
  active?: string;
  children: ReactNode;
}) {
  if (!isPanelAllowed(id, surface)) return null;
  if (active !== undefined && active !== id) return null;
  return <>{children}</>;
}
