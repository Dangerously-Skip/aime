import type { WidgetNode } from './catalog';

/**
 * What changed, in words — not merely THAT something did.
 *
 * "Camera watchlist updated" is a notification you learn to dismiss without
 * reading, because it costs a click to find out whether it mattered. "Camera
 * watchlist: best ROI now 112% (was 98%)" is one you can act on, or ignore, from
 * the notification itself.
 *
 * WHY WE CAN DO THIS AND A TEXT-BASED AGENT CANNOT. Our change detection is
 * structural — a render tree compared against a render tree — so the diff
 * already knows which node moved. A heartbeat comparing prose can only say
 * "different". Throwing that away at the notification boundary would waste the
 * single advantage the widget model has.
 *
 * HONEST WHEN IT CANNOT CHARACTERISE. Some diffs have no short description: a
 * table with six changed rows, a chart with new points. Those return null and
 * the caller says "updated", which is the truth. Inventing a summary for a
 * change it did not understand is the same defect as an uncited price.
 */

/** A labelled scalar somewhere in the tree — the things worth naming in an alert. */
interface Labelled {
  label: string;
  value: string;
}

/** Pull every labelled scalar out, keyed by label, in document order. */
function labelledValues(node: WidgetNode | null, out: Labelled[] = []): Labelled[] {
  if (!node) return out;
  switch (node.type) {
    case 'metric':
      out.push({ label: node.label, value: node.value });
      break;
    case 'statGrid':
      for (const i of node.items) out.push({ label: i.label, value: i.value });
      break;
    case 'keyValue':
      for (const r of node.rows) out.push({ label: r.key, value: r.value });
      break;
    case 'progress':
      if (node.label) out.push({ label: node.label, value: `${Math.round(node.value * 100)}%` });
      break;
    case 'section':
    case 'card':
      for (const c of node.children) labelledValues(c, out);
      break;
    default:
      break;
  }
  return out;
}

/** Every list/timeline item's text, so additions can be named. */
function itemTexts(node: WidgetNode | null, out: string[] = []): string[] {
  if (!node) return out;
  switch (node.type) {
    case 'list':
      for (const i of node.items) out.push(i.text);
      break;
    case 'timeline':
      for (const i of node.items) out.push(i.title);
      break;
    case 'section':
    case 'card':
      for (const c of node.children) itemTexts(c, out);
      break;
    default:
      break;
  }
  return out;
}

/** At most this many changes are named; beyond it, a count reads better. */
const MAX_NAMED = 2;

/**
 * Describe the difference, or null when it cannot be put briefly.
 *
 * Null is a real answer and the caller must handle it — see the note above about
 * inventing summaries.
 */
export function describeChange(previous: WidgetNode | null, next: WidgetNode | null): string | null {
  if (!next) return null;
  if (!previous) return null; // first render: "now showing" is the caller's business

  // 1. Labelled scalars that moved — the clearest and commonest case.
  const before = new Map(labelledValues(previous).map((l) => [l.label, l.value]));
  const after = labelledValues(next);
  const moved: string[] = [];
  for (const { label, value } of after) {
    const was = before.get(label);
    if (was !== undefined && was !== value) moved.push(`${label} now ${value} (was ${was})`);
  }
  if (moved.length > 0) {
    return moved.length <= MAX_NAMED
      ? moved.join('; ')
      : `${moved.slice(0, MAX_NAMED).join('; ')}, and ${moved.length - MAX_NAMED} more`;
  }

  // 2. Items added or removed from a list.
  const beforeItems = itemTexts(previous);
  const afterItems = itemTexts(next);
  const added = afterItems.filter((t) => !beforeItems.includes(t));
  const removed = beforeItems.filter((t) => !afterItems.includes(t));
  if (added.length > 0 && removed.length === 0) {
    return added.length <= MAX_NAMED
      ? `new: ${added.join(', ')}`
      : `${added.length} new items`;
  }
  if (removed.length > 0 && added.length === 0) {
    return removed.length <= MAX_NAMED
      ? `gone: ${removed.join(', ')}`
      : `${removed.length} items gone`;
  }
  if (added.length > 0 && removed.length > 0) {
    return `${added.length} in, ${removed.length} out`;
  }

  // 3. Something changed that we cannot summarise. Say nothing rather than guess.
  return null;
}

/** The line an alert shows for one widget. */
export function changeHeadline(
  widgetTitle: string,
  previous: WidgetNode | null,
  next: WidgetNode | null,
): string {
  if (!previous) return `${widgetTitle}: first results`;
  const detail = describeChange(previous, next);
  return detail ? `${widgetTitle}: ${detail}` : `${widgetTitle} updated`;
}
