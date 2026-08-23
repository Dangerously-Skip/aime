import { describe, it, expect } from 'vitest';
import { widgetNodeToText, widgetConversationSeed } from './widget-to-text';
import type { WidgetNode } from './catalog';

/**
 * A BRIEFING YOU CAN REPLY TO.
 *
 * A widget is glanceable and mute: you can see that three cameras are
 * underpriced and you cannot ask which to bid on. That is the one thing a
 * heartbeat could do that a scheduled widget cannot — start a conversation —
 * and this is how the widget model gets it back without a second proactive
 * mechanism competing with the first.
 */

const NOW = 1_700_000_000_000;

describe('rendering a card as text', () => {
  it('renders a table as a real markdown table', () => {
    // A comparison grid is the commonest briefing shape, and models read
    // markdown tables far better than prose.
    const node: WidgetNode = {
      type: 'table',
      columns: ['Camera', 'Bid', 'Market'],
      rows: [['Nikon FM', '$77', '$605']],
    };
    const out = widgetNodeToText(node);
    expect(out).toContain('| Camera | Bid | Market |');
    expect(out).toContain('| --- | --- | --- |');
    expect(out).toContain('| Nikon FM | $77 | $605 |');
  });

  it('renders metrics and lists legibly', () => {
    expect(widgetNodeToText({ type: 'metric', label: 'Open PRs', value: '3', delta: '+1' }))
      .toBe('**Open PRs:** 3 (+1)');
    expect(
      widgetNodeToText({
        type: 'list',
        items: [{ text: 'Nikon FM', sub: 'ROI 98%', badge: 'best' }],
      }),
    ).toBe('- Nikon FM — ROI 98% [best]');
  });

  it('walks nested cards and sections', () => {
    const node: WidgetNode = {
      type: 'card',
      title: 'Watchlist',
      children: [
        { type: 'text', text: 'Two movers today.' },
        { type: 'metric', label: 'Best ROI', value: '98%' },
      ],
    };
    const out = widgetNodeToText(node);
    expect(out).toContain('## Watchlist');
    expect(out).toContain('Two movers today.');
    expect(out).toContain('**Best ROI:** 98%');
  });

  it('is lossy where losing detail is correct', () => {
    /*
     * A conversation opener, not a round trip. The widget stays the source of
     * truth and the recipe travels alongside, so the agent can re-derive
     * anything it actually needs.
     */
    expect(
      widgetNodeToText({ type: 'chart', chart: 'line', points: [{ label: 'a', value: 1 }], title: 'Prices' } as WidgetNode),
    ).toBe('[line chart: Prices — 1 points]');
    expect(widgetNodeToText({ type: 'image', src: 'x.png', alt: 'a graph' })).toBe('[image: a graph]');
  });

  it('renders nothing for nothing, rather than throwing', () => {
    expect(widgetNodeToText(null)).toBe('');
  });
});

describe('the conversation seed', () => {
  const widget = { title: 'Camera watchlist', recipe: 'track camera ROI on allbids', refreshedAt: NOW - 600_000 };
  const node: WidgetNode = { type: 'metric', label: 'Best ROI', value: '98%' };

  it('leads with the card, because that is what the user is looking at', () => {
    const seed = widgetConversationSeed(widget, node, NOW);
    expect(seed).toContain('**Camera watchlist**');
    expect(seed).toContain('**Best ROI:** 98%');
  });

  it('carries the RECIPE, so the agent is not guessing where numbers came from', () => {
    /*
     * The likeliest next question is "why is that one cheap?" or "add shipping".
     * Without the recipe the agent invents a provenance, which is an uncited
     * claim one layer up.
     */
    expect(widgetConversationSeed(widget, node, NOW)).toContain('track camera ROI on allbids');
  });

  it('says how stale the tile is', () => {
    expect(widgetConversationSeed(widget, node, NOW)).toContain('10 minutes ago');
  });

  it('handles a widget that has never run', () => {
    const seed = widgetConversationSeed({ title: 'New', recipe: 'r' }, null, NOW);
    expect(seed).toContain('has not run yet');
    expect(seed).toContain('has not rendered anything yet');
  });

  it('tells the agent it cannot edit the widget from here', () => {
    // Otherwise it will cheerfully agree to change what the tile tracks and
    // nothing will happen — a claim with nothing behind it.
    expect(widgetConversationSeed(widget, node, NOW)).toMatch(/editing the widget is a separate action/i);
  });
});
