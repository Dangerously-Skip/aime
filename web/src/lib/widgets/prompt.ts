/**
 * The system prompt for a widget refresh.
 *
 * A widget is a stored natural-language **recipe**, re-run on a schedule — not
 * stored data. That is the load-bearing idea (ported from Burnbox): the tile
 * describes what the user wants to know, and each refresh goes and finds out.
 *
 * Two things this prompt has to get right, both learned from that prior art:
 *
 * 1. **Grounding.** A widget with no data source must not invent user-specific
 *    facts. An ungrounded tile confidently reporting yesterday's build status is
 *    worse than an empty one, because it looks authoritative.
 * 2. **Chart discipline.** Models reach for charts constantly, including for
 *    clock times, IDs and two-category comparisons, where a chart actively
 *    misleads. The guardrail is explicit and worth its length.
 */
import { KNOWN_ACTIONS } from './actions';

const CATALOGUE = `
Allowed node types (use ONLY these):
  text {text, variant?: body|heading|subheading|caption|label}
  metric {label, value, delta?, state?: up|down|neutral}
  statGrid {items: [{label, value, delta?, state?}]}
  list {items: [{text, sub?, badge?}], ordered?}
  table {columns: [string], rows: [[string]]}
  keyValue {rows: [{key, value}]}
  badge {text, tone?: neutral|success|warn|danger|info}
  timeline {items: [{time?, title, sub?}]}
  progress {value: 0-100, label?}
  chart {chart: bar|line|area|pie, points: [{label, value}], title?, unit?}
  divider {}
  image {src: MUST be a data: URL, alt?}
  actionButton {label, action, tone?}
  section {title?, children: [node]}
  card {title?, subtitle?, children: [node]}
`.trim();

const RULES = `
Rules:
- Return ONE node (usually a \`card\` or \`section\` wrapping a few children).
- Use a \`chart\` ONLY to compare numeric MAGNITUDES — a trend over time, or a
  breakdown where bigger-vs-smaller is meaningful. NEVER for clock times, dates,
  IDs, coordinates, or just 2-3 categories. Use keyValue/table/list/timeline for
  those.
- Fill the tile with the REAL data you gathered. Never an empty or near-empty
  shell, and never placeholder values.
- \`image\` src must be a data: URL. A remote URL will be discarded.
- \`action\` must be one of: ${KNOWN_ACTIONS.join(', ')}. Any other action is
  discarded and its button rendered disabled, so do not invent one.
- Keep it compact: this renders as a dashboard tile, not a report.
`.trim();

const GROUNDED = `
Grounding: you have access to the tools listed above. Gather the data FIRST,
then render it. Be FAST — make at most ~2 searches or fetches in total, then
render with what you have. A tile that arrives quickly with partial real data
beats a slow exhaustive one.
`.trim();

const UNGROUNDED = `
Grounding: this widget has NO connected data source. You have NO access to the
user's conversations, projects, files, or the web. You MUST NOT invent or guess
any user-specific facts, numbers, names, dates, or statuses. Render only what is
genuinely answerable from general knowledge, or a short \`text\` node saying the
widget needs a data source. An empty tile is far better than a confident wrong
one.
`.trim();

const WEB_UNCONFIGURED = `
Note: web search is not configured, so you cannot look anything up online. Do
not claim to have searched, and do not fabricate results.
`.trim();

/**
 * Assemble the widget system prompt.
 *
 * @param grounded    the widget has a real data source (tools/scope) to read
 * @param webUnconfigured  web search is unavailable in this install
 */
export function widgetSystemPrompt(opts: { grounded: boolean; webUnconfigured?: boolean }): string {
  return [
    'You are rendering a single dashboard widget as a tree of JSON from a fixed catalogue.',
    CATALOGUE,
    RULES,
    opts.grounded ? GROUNDED : UNGROUNDED,
    opts.webUnconfigured ? WEB_UNCONFIGURED : '',
    'Respond with ONLY the JSON node. No prose, no markdown fence.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Pull a widget node out of a model reply. Models wrap JSON in prose or fences
 * despite instructions, so accept the common shapes rather than failing a whole
 * refresh over formatting.
 */
export function extractWidgetJson(reply: string): unknown {
  if (!reply) return null;

  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], reply].filter((c): c is string => Boolean(c?.trim()));

  for (const candidate of candidates) {
    const text = candidate.trim();
    try {
      return JSON.parse(text);
    } catch {
      // Fall back to the outermost {...}, which handles leading/trailing prose.
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(text.slice(start, end + 1));
        } catch {
          // try the next candidate
        }
      }
    }
  }
  return null;
}
