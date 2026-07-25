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

export interface Widget {
  id: string;
  title: string;
  /** The stored natural-language instruction, re-run on each refresh. */
  recipe: string;
  /** Last successfully rendered node. Null until the first refresh lands. */
  render: WidgetNode | null;
  refreshedAt?: number;
  /** Interval in seconds; absent ⇒ manual refresh only. */
  refreshEverySeconds?: number;
  /** Whether the refresh agent may reach the web. */
  allowWeb?: boolean;
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
