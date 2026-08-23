import type { Widget } from './widget';
import { renderFingerprint } from './unchanged';

/**
 * Has this tile changed since the user last LOOKED at it?
 *
 * THE DISTINCTION THAT MAKES THIS HONEST. The obvious implementation is a flag
 * set by a refresh that changed something. It produces a badge that lies:
 *
 *   09:00  refresh finds news        → flag set, you are away
 *   10:00  refresh finds nothing new → flag cleared
 *   10:05  you look                  → no badge, and the 09:00 news is gone
 *
 * Comparing the current render against the one the user last SAW survives any
 * number of unchanged refreshes in between. A badge that clears itself is worse
 * than no badge, because you stop checking manually once you believe it.
 */
export function isUnread(widget: Pick<Widget, 'render' | 'seenFingerprint'>): boolean {
  if (!widget.render) return false; // nothing to read
  const current = renderFingerprint(widget.render);
  // Never seen anything: the first render IS news.
  if (widget.seenFingerprint === undefined) return true;
  return widget.seenFingerprint !== current;
}

/** The fingerprint to store when the user views a tile. */
export function seenValue(widget: Pick<Widget, 'render'>): string {
  return renderFingerprint(widget.render ?? null);
}

/** How many tiles are unread — the number a badge shows. */
export function unreadCount(widgets: Array<Pick<Widget, 'render' | 'seenFingerprint'>>): number {
  return widgets.filter(isUnread).length;
}
