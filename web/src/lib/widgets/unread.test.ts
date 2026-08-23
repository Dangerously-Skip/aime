import { describe, it, expect } from 'vitest';
import { isUnread, seenValue, unreadCount } from './unread';
import { renderFingerprint } from './unchanged';
import type { WidgetNode } from './catalog';

/**
 * A BADGE THAT CLEARS ITSELF IS WORSE THAN NO BADGE.
 *
 * The obvious implementation — a flag set by a refresh that changed something —
 * loses news silently:
 *
 *   09:00  refresh finds news        → flag set, user is away
 *   10:00  refresh finds nothing new → flag cleared
 *   10:05  user looks                → no badge, 09:00 news never read
 *
 * Comparing against what was SEEN survives any number of unchanged refreshes.
 */

const node = (value: string): WidgetNode => ({ type: 'metric', label: 'ROI', value });

describe('unread', () => {
  it('a tile that has never rendered is not unread', () => {
    expect(isUnread({ render: null, seenFingerprint: undefined })).toBe(false);
  });

  it('a first render is unread', () => {
    expect(isUnread({ render: node('98%'), seenFingerprint: undefined })).toBe(true);
  });

  it('is read once seen', () => {
    const render = node('98%');
    expect(isUnread({ render, seenFingerprint: renderFingerprint(render) })).toBe(false);
  });

  it('becomes unread again when the content changes', () => {
    const seen = renderFingerprint(node('98%'));
    expect(isUnread({ render: node('112%'), seenFingerprint: seen })).toBe(true);
  });

  it('SURVIVES an unchanged refresh in between — the whole point', () => {
    /*
     * The 09:00/10:00 case. Whatever happens on refresh, the comparison is
     * against what the user saw, so unread stays true until they actually look.
     */
    const seenAt0900 = renderFingerprint(node('98%'));
    const changed = node('112%');
    // …many unchanged refreshes later, the render is still the changed one
    expect(isUnread({ render: changed, seenFingerprint: seenAt0900 })).toBe(true);
    expect(isUnread({ render: changed, seenFingerprint: seenAt0900 })).toBe(true);
  });

  it('going back to the previously-seen content is read, not unread', () => {
    // A value that bounces 98 → 112 → 98 while you were away is not news by the
    // time you look: the tile shows exactly what you last saw.
    const seen = renderFingerprint(node('98%'));
    expect(isUnread({ render: node('98%'), seenFingerprint: seen })).toBe(false);
  });
});

describe('marking seen', () => {
  it('stores the fingerprint of what is on screen', () => {
    const render = node('98%');
    expect(seenValue({ render })).toBe(renderFingerprint(render));
    expect(isUnread({ render, seenFingerprint: seenValue({ render }) })).toBe(false);
  });
});

describe('the count a badge shows', () => {
  it('counts only unread tiles', () => {
    const seen = renderFingerprint(node('1'));
    expect(
      unreadCount([
        { render: node('1'), seenFingerprint: seen },   // read
        { render: node('2'), seenFingerprint: seen },   // changed
        { render: node('3'), seenFingerprint: undefined }, // never seen
        { render: null, seenFingerprint: undefined },   // never ran
      ]),
    ).toBe(2);
  });
});
