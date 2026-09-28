/**
 * THE interval parser. Every reader of an interval expression goes through here.
 *
 * WHY ONE. There were two with different grammars: the tickers (`due.ts`)
 * accepted `\d+ (s|sec|m|min|h|hr|d|day)s?` and nothing else, while the Cockpit's
 * goal adapter accepted decimals and long spellings. So an order saved as
 * `90 minutes` or `1.5h` showed a "next run" in the Cockpit and never fired —
 * the one place that said when it would run was the one place that could read
 * it. Two parsers of one grammar is that bug waiting to recur, so there is one.
 *
 * GRAMMAR, stated so a reader need not reverse it from the regex:
 *
 *   interval := ["every"] segment { ["," | "and"] segment }
 *   segment  := number unit            number: 5, 1.5
 *   unit     := s|sec|secs|second|seconds | m|min|mins|minute|minutes
 *             | h|hr|hrs|hour|hours      | d|day|days | w|wk|wks|week|weeks
 *
 * so `5m`, `5 min`, `90 minutes`, `1.5h`, `1h 30m`, `every 2 hours` all parse.
 *
 * A BARE NUMBER IS REJECTED. `90` could mean seconds or minutes, and guessing
 * wrong fires a job sixty times too often. `month` is rejected too: `m` is
 * minutes, and reading `1 month` as one minute is the worst possible guess.
 *
 * Pure and import-free, like `due.ts`, so the server ticker can use it.
 */

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** One `<number><unit>` segment, anchored where the previous one ended. */
const SEGMENT =
  /(\d+(?:\.\d+)?)\s*(weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])\s*(?:,\s*|and\s+)?/y;

/** Shortest interval accepted. The tickers run once a minute anyway. */
export const MIN_INTERVAL_MS = 1_000;

/** `90 minutes`, `1.5h`, `1h 30m` → milliseconds. Null when unreadable. */
export function parseIntervalMs(expression: string | null | undefined): number | null {
  if (typeof expression !== 'string') return null;
  let text = expression.trim().toLowerCase();
  if (text.startsWith('every ')) text = text.slice(6).trim();
  if (!text) return null;

  let total = 0;
  let pos = 0;
  while (pos < text.length) {
    SEGMENT.lastIndex = pos;
    const m = SEGMENT.exec(text);
    if (!m) return null;
    total += Number(m[1]) * UNIT_MS[m[2][0]];
    pos = SEGMENT.lastIndex;
  }

  if (!Number.isFinite(total) || total < MIN_INTERVAL_MS) return null;
  return Math.round(total);
}

/** The largest unit that divides `ms` evenly, for storage and for display. */
function largestUnit(ms: number): { value: number; unit: 'w' | 'd' | 'h' | 'm' | 's' } {
  for (const unit of ['w', 'd', 'h', 'm'] as const) {
    if (ms % UNIT_MS[unit] === 0) return { value: ms / UNIT_MS[unit], unit };
  }
  return { value: Math.round(ms / 1_000), unit: 's' };
}

/**
 * The canonical spelling: `90m`, `2h`, `1d`. What a save normalises to, so the
 * stored expression is one every reader — including an older build's — accepts.
 */
export function canonicalInterval(ms: number): string {
  const { value, unit } = largestUnit(ms);
  return `${value}${unit}`;
}

const UNIT_WORD = { w: 'week', d: 'day', h: 'hour', m: 'minute', s: 'second' } as const;

/** `Every 90 minutes`, `Every hour`, `Every 2 days`. */
export function describeIntervalMs(ms: number): string {
  const { value, unit } = largestUnit(ms);
  return value === 1 ? `Every ${UNIT_WORD[unit]}` : `Every ${value} ${UNIT_WORD[unit]}s`;
}
