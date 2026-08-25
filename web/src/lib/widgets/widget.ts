/**
 * A widget is a Goal whose deliverable is a rendered node.
 *
 * Nothing here duplicates the Goal/Run substrate — a widget IS a goal
 * (`recipe` is its objective, `refreshEverySeconds` its schedule), and each
 * refresh is an ordinary Run. That's what gives tiles run history, cost
 * attribution and failure streaks for free, which is precisely what Burnbox's
 * widgets lacked.
 */
import type { Goal } from '@/lib/runs/types';
import type { WidgetNode } from './catalog';
import type { WidgetPresetConfig } from '@/lib/assistant/widget-config';

export interface Widget {
  id: string;
  title: string;
  /** The stored natural-language instruction, re-run on each refresh. */
  recipe: string;
  /**
   * HOW this widget refreshes — deterministically, or by asking an agent.
   *
   * Two axes were conflated before, and splitting them is the whole point of
   * this change. "Who authored it" decided everything: things we shipped got a
   * built-in fetcher and lived in the activity feed as cards; things you made
   * got an agent and lived in the Cockpit. So you could not have a cheap custom
   * widget or a smart built-in one, and identical objects had two homes.
   *
   * The real axes are independent:
   *   - EVENT vs STATE — a widget is state; the activity feed is events.
   *   - DETERMINISTIC vs AGENT — this field.
   *
   * A stock price should never cost a model call. "Rank my PRs by staleness"
   * needs one. That is a property of the refresh, not a different kind of thing.
   *
   * Absent ⇒ agent, using `recipe`. That keeps every existing widget working
   * without a migration.
   */
  refreshKind?: 'weather' | 'tickers' | 'clocks';
  /**
   * What a deterministic widget shows — the city, the symbols, the zones.
   *
   * ON THE WIDGET, not in global settings, because the question "which city?"
   * has as many answers as you have weather tiles. A single global location
   * would make the second one pointless.
   *
   * Absent ⇒ the defaults derived from the user's own time zone. Partial by
   * design: editing your tickers must not also freeze your clocks at whatever
   * they happened to be that day.
   */
  config?: Partial<WidgetPresetConfig>;
  /** Last successfully rendered node. Null until the first refresh lands. */
  render: WidgetNode | null;
  refreshedAt?: number;
  /** Interval in seconds; absent ⇒ manual refresh only. */
  refreshEverySeconds?: number;
  /** Whether the refresh agent may reach the web. */
  allowWeb?: boolean;
  /**
   * The render the user has actually LOOKED at, as a fingerprint.
   *
   * Not "did the last refresh change anything" — that is a different question
   * and answering it would produce a badge that lies. Consider: the tile changes
   * at 09:00 while you are away, then refreshes unchanged at 10:00. A flag set
   * by the last refresh clears itself, and the news you never read is gone.
   *
   * Comparing against what was SEEN survives any number of unchanged refreshes,
   * which is the only version of this that is honest.
   */
  seenFingerprint?: string;
  /** Interrupt with an OS notification when this widget changes. Default off. */
  notifyOnChange?: boolean;
  /** Scope: a conversation or project supplies the data the recipe reads. */
  scopeConversationId?: string;
  scopeProjectId?: string;
  enabled: boolean;
  createdAt: number;
}

/**
 * A widget is "grounded" when the refresh has some real source to read — a
 * scope, or the web. Ungrounded widgets get the hard no-invention prompt,
 * because a confident wrong tile is worse than an empty one.
 */
export function isGrounded(widget: Pick<Widget, 'allowWeb' | 'scopeConversationId' | 'scopeProjectId'>): boolean {
  return Boolean(widget.allowWeb || widget.scopeConversationId || widget.scopeProjectId);
}

/**
 * Project a Widget onto the Goal it is. Ids are namespaced so widget runs and
 * standing-order runs can't collide in the run log.
 */
export function widgetToGoal(widget: Widget): Goal {
  return {
    id: `widget:${widget.id}`,
    sourceId: widget.id,
    objective: widget.recipe,
    // The tile rendering IS the success criterion; verification is structural
    // (did we get a valid node?) rather than semantic, so no successCriteria.
    approvalPolicy: 'never', // read-only generation, nothing consequential
    schedule: widget.refreshEverySeconds ? { everySeconds: widget.refreshEverySeconds } : undefined,
    enabled: widget.enabled,
    createdAt: widget.createdAt,
    lastRunAt: widget.refreshedAt,
    surfaceId: 'assistant',
    // Widget refreshes are short structured generations — pin them cheap rather
    // than spending a reasoning budget on a dashboard tile.
    capability: 'chat',
    tier: 'cheap',
  };
}

/** Hard ceiling on a refresh. A tile is not worth an unbounded agent run. */
export const WIDGET_REFRESH_TIMEOUT_MS = 180_000;
