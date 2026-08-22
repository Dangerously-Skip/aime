import { describe, it, expect } from 'vitest';
import { inQuietHours, buildDigest, decideAlert } from './alerting';
import { describeChange, changeHeadline } from './describe-change';
import type { WidgetNode } from './catalog';

/**
 * THE FAILURE THIS GUARDS IS FATIGUE, NOT COST.
 *
 * OpenClaw's whole `HEARTBEAT_OK` apparatus exists because a proactive agent
 * that reports every cycle teaches you to ignore it — and the fastest route
 * there is a fan-out: three briefings at 9am become three notifications, and the
 * third is where the feature gets switched off.
 */

const metric = (label: string, value: string): WidgetNode => ({ type: 'metric', label, value });
const card = (...children: WidgetNode[]): WidgetNode => ({ type: 'card', children });

describe('describing what changed, not that it did', () => {
  /*
   * "Camera watchlist updated" costs a click to find out whether it mattered.
   * We can do better than a text-based agent here precisely because our diff is
   * structural — it already knows which node moved.
   */
  it('names a moved value, with what it was', () => {
    expect(describeChange(metric('Best ROI', '98%'), metric('Best ROI', '112%')))
      .toBe('Best ROI now 112% (was 98%)');
  });

  it('names two, then counts', () => {
    const before = card(metric('A', '1'), metric('B', '2'), metric('C', '3'));
    const after = card(metric('A', '9'), metric('B', '8'), metric('C', '7'));
    expect(describeChange(before, after)).toMatch(/A now 9 \(was 1\); B now 8 \(was 2\), and 1 more/);
  });

  it('names items added to a list', () => {
    const before = { type: 'list', items: [{ text: 'Nikon FM' }] } as WidgetNode;
    const after = { type: 'list', items: [{ text: 'Nikon FM' }, { text: 'Bessaflex TM' }] } as WidgetNode;
    expect(describeChange(before, after)).toBe('new: Bessaflex TM');
  });

  it('names items removed', () => {
    const before = { type: 'list', items: [{ text: 'a' }, { text: 'b' }] } as WidgetNode;
    const after = { type: 'list', items: [{ text: 'a' }] } as WidgetNode;
    expect(describeChange(before, after)).toBe('gone: b');
  });

  it('returns NULL rather than inventing a summary it does not have', () => {
    /*
     * Some diffs have no short description — a table with six changed rows, a
     * chart with new points. Making one up is the same defect as an uncited
     * price, and the caller falls back to the honest "updated".
     */
    const before = { type: 'chart', chart: 'line', points: [{ label: 'a', value: 1 }] } as WidgetNode;
    const after = { type: 'chart', chart: 'line', points: [{ label: 'a', value: 2 }] } as WidgetNode;
    expect(describeChange(before, after)).toBeNull();
    expect(changeHeadline('Prices', before, after)).toBe('Prices updated');
  });

  it('a first render says so rather than pretending to diff', () => {
    expect(changeHeadline('Watchlist', null, metric('a', 'b'))).toBe('Watchlist: first results');
  });
});

describe('quiet hours', () => {
  const at = (h: number) => new Date(2026, 7, 23, h, 0, 0);

  it('is off when unconfigured', () => {
    expect(inQuietHours(at(3), null)).toBe(false);
    expect(inQuietHours(at(3), undefined)).toBe(false);
  });

  it('handles a same-day window', () => {
    expect(inQuietHours(at(10), { fromHour: 9, toHour: 17 })).toBe(true);
    expect(inQuietHours(at(18), { fromHour: 9, toHour: 17 })).toBe(false);
  });

  it('handles the overnight window, which is the only one anyone sets', () => {
    /*
     * 22 → 7 wraps midnight. Treating it as an ordinary range would make it
     * quiet for exactly the hours the user wants noise — the inverse of the
     * setting.
     */
    const overnight = { fromHour: 22, toHour: 7 };
    expect(inQuietHours(at(23), overnight)).toBe(true);
    expect(inQuietHours(at(2), overnight)).toBe(true);
    expect(inQuietHours(at(6), overnight)).toBe(true);
    expect(inQuietHours(at(7), overnight)).toBe(false);
    expect(inQuietHours(at(12), overnight)).toBe(false);
  });

  it('treats a zero-width window as always quiet', () => {
    expect(inQuietHours(at(12), { fromHour: 9, toHour: 9 })).toBe(true);
  });
});

describe('the digest — one alert, not N', () => {
  const a = (widgetId: string, headline: string) => ({ widgetId, headline });

  it('is null for nothing', () => {
    expect(buildDigest([], 'AIME')).toBeNull();
  });

  it('a single change keeps its detail, split into title and body', () => {
    // That detail is what makes a notification actionable without opening it.
    const d = buildDigest([a('w1', 'Camera watchlist: best ROI now 112%')], 'AIME')!;
    expect(d.title).toBe('Camera watchlist');
    expect(d.body).toBe('best ROI now 112%');
    expect(d.count).toBe(1);
  });

  it('several become ONE alert with a count', () => {
    const d = buildDigest([a('1', 'A: x'), a('2', 'B: y'), a('3', 'C: z')], 'AIME')!;
    expect(d.title).toBe('3 briefings updated');
    expect(d.count).toBe(3);
    expect(d.body).toContain('A: x');
  });

  it('caps the lines, because a wall of text in a toast reads as noise', () => {
    const many = Array.from({ length: 7 }, (_, i) => a(String(i), `W${i}: changed`));
    const d = buildDigest(many, 'AIME')!;
    expect(d.body.split('\n')).toHaveLength(4); // 3 headlines + "and N more"
    expect(d.body).toContain('and 4 more');
  });
});

describe('deciding whether to interrupt', () => {
  const alerts = [{ widgetId: 'w1', headline: 'Watchlist: changed' }];
  const noon = new Date(2026, 7, 23, 12, 0, 0);

  it('delivers when there is news and nothing forbids it', () => {
    const d = decideAlert(alerts, { notify: true }, noon, 'AIME');
    expect(d.deliver).toBe(true);
  });

  it('says nothing when there is nothing', () => {
    expect(decideAlert([], { notify: true }, noon, 'AIME')).toEqual({
      deliver: false,
      reason: 'nothing-pending',
    });
  });

  it('respects the per-widget toggle', () => {
    expect(decideAlert(alerts, { notify: false }, noon, 'AIME')).toEqual({
      deliver: false,
      reason: 'notifications-off',
    });
  });

  it('respects quiet hours', () => {
    const night = new Date(2026, 7, 23, 3, 0, 0);
    expect(
      decideAlert(alerts, { notify: true, quietHours: { fromHour: 22, toHour: 7 } }, night, 'AIME'),
    ).toEqual({ deliver: false, reason: 'quiet-hours' });
  });

  it('gives a REASON when it declines, so a silent alert is diagnosable', () => {
    // "It did not notify me" is otherwise unanswerable without a debugger.
    const d = decideAlert(alerts, { notify: false }, noon, 'AIME');
    expect(d.deliver === false && d.reason).toBeTruthy();
  });
});
