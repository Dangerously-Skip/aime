import type { WidgetNode } from './catalog';

/**
 * Did this refresh actually change anything?
 *
 * WHY THIS EXISTS, AND WHY IT IS THE HEART OF THE FEATURE. Both mature
 * implementations of proactive agents are built around suppressing the
 * no-news case, and they say so plainly:
 *
 *   - OpenClaw's heartbeat replies `HEARTBEAT_OK` when there is nothing to
 *     report, and the gateway DROPS it — never delivered. It also thresholds on
 *     `ackMaxChars` (300) to classify a reply as routine.
 *   - Hermes ships a "don't-invent-work guard": the standing instruction asks
 *     for a brief reply and no busywork when nothing meaningful changed.
 *
 * Both learned the same thing: a proactive agent that reports every cycle
 * teaches you to ignore it, and an agent you ignore is worse than none. The
 * failure is not cost, it is that the user stops looking.
 *
 * OURS IS STRUCTURAL RATHER THAN TEXTUAL, which is a real advantage of the
 * widget model. A widget returns a RENDER TREE, so "nothing changed" is a
 * comparison rather than a judgement — no threshold to tune, no model asked to
 * assess its own novelty, and no way for a chatty model to defeat it by padding.
 *
 * WHAT THIS IS NOT. It does not decide whether to RUN — the schedule does that.
 * It decides whether a completed run counts as news.
 */

/**
 * A stable fingerprint of a rendered widget.
 *
 * Key order is normalised, because a model re-emitting the same tree with its
 * keys in a different order is the same tile. Without that, "unchanged" would
 * be true only by luck and the whole suppression would be noise.
 */
export function renderFingerprint(node: WidgetNode | null): string {
  if (!node) return '';
  return JSON.stringify(node, replacerSortingKeys());
}

function replacerSortingKeys() {
  return function (this: unknown, _key: string, value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  };
}

export interface ChangeVerdict {
  changed: boolean;
  /** Why, in words a user could read in a run log. */
  reason: 'first-render' | 'content-changed' | 'unchanged' | 'nothing-rendered';
}

/**
 * Compare a fresh render against what the tile already shows.
 *
 * FIRST RENDER IS ALWAYS NEWS, even against an empty previous — the tile going
 * from "never run" to showing something is exactly what the user is waiting for.
 */
export function judgeChange(previous: WidgetNode | null, next: WidgetNode | null): ChangeVerdict {
  if (!next) return { changed: false, reason: 'nothing-rendered' };
  if (!previous) return { changed: true, reason: 'first-render' };
  return renderFingerprint(previous) === renderFingerprint(next)
    ? { changed: false, reason: 'unchanged' }
    : { changed: true, reason: 'content-changed' };
}

/**
 * The guard added to a scheduled refresh's prompt.
 *
 * Hermes's "don't-invent-work" instruction, in our words. The structural check
 * above already stops an unchanged tile from being announced — but a model told
 * only "refresh this" will often MANUFACTURE difference to look useful:
 * re-ordering rows, rephrasing a heading, adding a bogus "as of" line. That
 * defeats a structural comparison honestly rather than dishonestly, which is
 * worse, because it produces churn nobody can distinguish from real change.
 *
 * So the prompt asks for stability explicitly, and gives permission to return
 * the same thing.
 */
export const NO_BUSYWORK_GUARD = `## If nothing has changed, return the same thing
This runs on a schedule, and most runs will find nothing new. That is the normal
outcome and it is a fine result — return the SAME content you would have
returned last time.

Do not manufacture difference to look useful: no re-ordering rows that have not
moved, no rephrasing a heading, no "as of <timestamp>" line that changes only
because time passed. An unchanged tile is suppressed and costs the user nothing;
a tile that churns teaches them to stop reading it, which is the one failure this
whole feature cannot survive.

Change the content when the underlying facts changed. Otherwise reproduce it.`;
