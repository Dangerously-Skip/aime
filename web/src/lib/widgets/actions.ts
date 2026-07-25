/**
 * Widget actions.
 *
 * Burnbox renders `actionButton` but never passes a handler, so its buttons are
 * inert — the primitive exists and does nothing. Since our tiles sit next to
 * real runs, "re-run this" and "open that" are obvious and worth designing up
 * front rather than inheriting the dead end.
 *
 * The contract: an action is a NAME from a closed, host-declared set. The model
 * chooses from the set; it never supplies behaviour. Anything outside the set is
 * rendered visibly disabled rather than silently ignored, so a tile can't
 * present a button that looks live and does nothing.
 */

export const WIDGET_ACTIONS = {
  /** Re-run the goal that produced this widget. */
  REFRESH: 'widget.refresh',
  /** Open the goal's run history in the Cockpit. */
  VIEW_RUNS: 'goal.viewRuns',
  /** Pause/resume the owning goal. */
  TOGGLE_ENABLED: 'goal.toggleEnabled',
  /** Open the most recent deliverable. */
  OPEN_DELIVERABLE: 'deliverable.open',
} as const;

export type WidgetActionName = (typeof WIDGET_ACTIONS)[keyof typeof WIDGET_ACTIONS];

/** Every action the host can service. The prompt advertises exactly this list. */
export const KNOWN_ACTIONS: readonly string[] = Object.values(WIDGET_ACTIONS);

export function isKnownAction(action: string): action is WidgetActionName {
  return KNOWN_ACTIONS.includes(action);
}

/**
 * Human labels, used for the disabled-state tooltip so an unsupported button
 * explains itself instead of appearing broken.
 */
export const ACTION_LABEL: Record<string, string> = {
  [WIDGET_ACTIONS.REFRESH]: 'Re-run this widget',
  [WIDGET_ACTIONS.VIEW_RUNS]: 'View run history',
  [WIDGET_ACTIONS.TOGGLE_ENABLED]: 'Pause or resume',
  [WIDGET_ACTIONS.OPEN_DELIVERABLE]: 'Open the latest result',
};

export type WidgetActionHandler = (action: WidgetActionName) => void | Promise<void>;
