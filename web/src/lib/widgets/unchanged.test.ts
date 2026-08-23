import { describe, it, expect } from 'vitest';
import { judgeChange, renderFingerprint, NO_BUSYWORK_GUARD } from './unchanged';
import type { WidgetNode } from './catalog';

/**
 * SUPPRESSING THE NO-NEWS CASE IS THE FEATURE, not a refinement of it.
 *
 * Both mature proactive-agent implementations are built around this. OpenClaw's
 * heartbeat answers `HEARTBEAT_OK` and the gateway DROPS it, never delivering.
 * Hermes ships a "don't-invent-work guard" asking for a brief reply and no
 * busywork when nothing meaningful changed.
 *
 * They learned the same thing, and it is not about cost: an agent that reports
 * every cycle teaches you to ignore it, and an agent you ignore is worse than
 * no agent.
 *
 * Ours is STRUCTURAL rather than textual, which the widget model makes possible:
 * a widget returns a render tree, so "unchanged" is a comparison rather than a
 * judgement — nothing to tune, and no way for a chatty model to defeat it.
 */

const tile = (label: string, value: string): WidgetNode =>
  ({ type: 'stat', label, value }) as unknown as WidgetNode;

describe('judging change', () => {
  it('a first render is always news', () => {
    // "never run" → showing something is exactly what the user is waiting for.
    expect(judgeChange(null, tile('Open PRs', '3'))).toEqual({
      changed: true,
      reason: 'first-render',
    });
  });

  it('identical content is not news', () => {
    const a = tile('Open PRs', '3');
    const b = tile('Open PRs', '3');
    expect(judgeChange(a, b)).toEqual({ changed: false, reason: 'unchanged' });
  });

  it('changed content is news', () => {
    expect(judgeChange(tile('Open PRs', '3'), tile('Open PRs', '4'))).toEqual({
      changed: true,
      reason: 'content-changed',
    });
  });

  it('a failed render is not news either', () => {
    // Nothing rendered must not be reported as a change, or every failure
    // becomes a notification.
    expect(judgeChange(tile('Open PRs', '3'), null)).toEqual({
      changed: false,
      reason: 'nothing-rendered',
    });
  });
});

describe('the comparison is stable against noise that is not change', () => {
  it('key order does not count as a change', () => {
    /*
     * Without normalising, "unchanged" would be true only by luck — a model
     * re-emitting the same tree with its keys in a different order is the same
     * tile, and treating it as news makes the whole suppression worthless.
     */
    const a = { type: 'stat', label: 'PRs', value: '3' } as unknown as WidgetNode;
    const b = { value: '3', label: 'PRs', type: 'stat' } as unknown as WidgetNode;
    expect(judgeChange(a, b).changed).toBe(false);
  });

  it('nested key order does not count either', () => {
    const a = { type: 'list', items: [{ text: 'a', done: false }] } as unknown as WidgetNode;
    const b = { type: 'list', items: [{ done: false, text: 'a' }] } as unknown as WidgetNode;
    expect(judgeChange(a, b).changed).toBe(false);
  });

  it('ARRAY order DOES count — a reordered list is a different list', () => {
    // Rank order is meaningful in a briefing: "top 3 by ROI" reordering is the
    // news. Normalising it away would hide the thing the user cares about.
    const a = { type: 'list', items: ['x', 'y'] } as unknown as WidgetNode;
    const b = { type: 'list', items: ['y', 'x'] } as unknown as WidgetNode;
    expect(judgeChange(a, b).changed).toBe(true);
  });

  it('an empty fingerprint for nothing, so two failures do not look equal to a render', () => {
    expect(renderFingerprint(null)).toBe('');
    expect(renderFingerprint(tile('a', 'b'))).not.toBe('');
  });
});

describe('the prompt guard', () => {
  /*
   * The structural check stops an unchanged tile being ANNOUNCED. It cannot stop
   * a model manufacturing difference to look useful — reordering rows, rephrasing
   * a heading, adding an "as of" line that changes only because time passed.
   * That defeats the comparison honestly, which is worse than defeating it
   * dishonestly: the churn is indistinguishable from real change.
   */
  it('gives explicit permission to return the same thing', () => {
    expect(NO_BUSYWORK_GUARD).toMatch(/return the SAME content/i);
    expect(NO_BUSYWORK_GUARD).toMatch(/that is the normal outcome|fine result/i);
  });

  it('names the specific ways a model fakes progress', () => {
    for (const trap of ['re-ordering', 'rephrasing', 'as of']) {
      expect(NO_BUSYWORK_GUARD.toLowerCase()).toContain(trap.toLowerCase());
    }
  });

  it('says WHY, because a rule with a reason survives paraphrase', () => {
    expect(NO_BUSYWORK_GUARD).toMatch(/teaches them to stop reading/i);
  });
});
