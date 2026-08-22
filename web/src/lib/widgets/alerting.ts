/**
 * When to interrupt someone, and how loudly.
 *
 * THE FAILURE THIS EXISTS TO AVOID is not cost, it is fatigue. OpenClaw's entire
 * `HEARTBEAT_OK` apparatus — suppress the routine cycle, threshold on reply
 * length, never deliver the no-news case — is there because a proactive agent
 * that reports every cycle teaches you to ignore it, and an agent you ignore is
 * worse than none.
 *
 * The fastest route to fatigue is a fan-out: three briefings scheduled for 9am
 * become three notifications, and the third one is where you turn the feature
 * off. So alerts COALESCE, and the quiet hours are about the interruption budget
 * rather than the (real, but secondary) token cost.
 */

export interface QuietHours {
  /** Local hour the quiet window opens, 0-23. */
  fromHour: number;
  /** Local hour it closes, 0-23. Equal to `fromHour` means always quiet. */
  toHour: number;
}

export interface AlertPolicy {
  /** OS notifications at all. Off means the quiet in-app mark only. */
  notify: boolean;
  quietHours?: QuietHours | null;
}

/**
 * Is `date` inside the quiet window?
 *
 * Handles the overnight case, which is the only one anybody configures: 22 → 7
 * wraps midnight, and treating it as an ordinary range would make it quiet for
 * exactly the hours the user wants noise.
 */
export function inQuietHours(date: Date, quiet: QuietHours | null | undefined): boolean {
  if (!quiet) return false;
  const { fromHour, toHour } = quiet;
  if (fromHour === toHour) return true; // a zero-width window means always quiet
  const h = date.getHours();
  return fromHour < toHour
    ? h >= fromHour && h < toHour
    : h >= fromHour || h < toHour; // wraps midnight
}

export interface PendingAlert {
  widgetId: string;
  /** Already-worded, e.g. "Camera watchlist: best ROI now 112% (was 98%)". */
  headline: string;
}

export interface Digest {
  title: string;
  body: string;
  count: number;
}

/**
 * Fold N changes into ONE notification.
 *
 * The whole reason this function exists: three widgets firing at 9am must be one
 * alert. A single change keeps its detail, because that detail is what makes a
 * notification actionable from the notification itself; several become a count
 * plus the first few headlines, because a wall of text in a toast is read as
 * noise regardless of what it says.
 */
export function buildDigest(alerts: PendingAlert[], appName: string): Digest | null {
  if (alerts.length === 0) return null;

  if (alerts.length === 1) {
    const [only] = alerts;
    // Split on the first colon so the widget name becomes the title — the part a
    // notification shows in bold and truncates last.
    const at = only.headline.indexOf(':');
    return at > 0
      ? { title: only.headline.slice(0, at), body: only.headline.slice(at + 1).trim(), count: 1 }
      : { title: appName, body: only.headline, count: 1 };
  }

  const MAX_LINES = 3;
  const shown = alerts.slice(0, MAX_LINES).map((a) => a.headline);
  const rest = alerts.length - shown.length;
  return {
    title: `${alerts.length} briefings updated`,
    body: rest > 0 ? `${shown.join('\n')}\n and ${rest} more` : shown.join('\n'),
    count: alerts.length,
  };
}

export type AlertDecision =
  | { deliver: true; digest: Digest }
  | { deliver: false; reason: 'nothing-pending' | 'notifications-off' | 'quiet-hours' };

/**
 * Should these changes interrupt, right now?
 *
 * NOTE WHAT THIS DOES NOT DECIDE: whether the in-app mark appears. That is
 * unconditional — a changed widget is always marked unread, because the mark
 * costs nothing and losing it means the user never learns the thing changed at
 * all. Quiet hours and the notify toggle govern INTERRUPTION, not record.
 */
export function decideAlert(
  alerts: PendingAlert[],
  policy: AlertPolicy,
  now: Date,
  appName: string,
): AlertDecision {
  if (alerts.length === 0) return { deliver: false, reason: 'nothing-pending' };
  if (!policy.notify) return { deliver: false, reason: 'notifications-off' };
  if (inQuietHours(now, policy.quietHours)) return { deliver: false, reason: 'quiet-hours' };
  const digest = buildDigest(alerts, appName);
  return digest ? { deliver: true, digest } : { deliver: false, reason: 'nothing-pending' };
}
