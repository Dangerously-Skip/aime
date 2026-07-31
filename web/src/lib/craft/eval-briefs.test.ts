import { describe, it, expect } from 'vitest';
import { EVAL_BRIEFS, BRIEF_IDS } from './eval-briefs';

/**
 * The brief set is a measuring instrument, so the properties that make a
 * before/after comparison valid are asserted rather than assumed.
 *
 * The one that matters most is stability: artifacts are filed under `id`, so a
 * rename or a renumber silently detaches every stored "before" from its "after"
 * and the comparison quietly becomes meaningless rather than failing.
 */

describe('the brief set is stable', () => {
  /**
   * Frozen deliberately. Adding a brief is fine — changing or removing one
   * invalidates prior comparisons, and this is the line that makes that a
   * decision rather than an accident.
   */
  it('has the ids the stored baseline is filed under', () => {
    expect(BRIEF_IDS).toEqual([
      'dashboard-ops',
      'marketing-saas',
      'data-table',
      'form-onboarding',
      'mobile-screen',
      'dark-app-shell',
      'slide-deck',
      'underspecified',
    ]);
  });

  it('has unique ids', () => {
    expect(new Set(BRIEF_IDS).size).toBe(BRIEF_IDS.length);
  });
});

describe('the set covers the shapes where the default style diverges', () => {
  it('spans more than one kind of surface', () => {
    // A set of eight marketing pages would measure one thing eight times.
    const shapes = new Set(EVAL_BRIEFS.map((b) => b.shape));
    expect(shapes.size).toBeGreaterThanOrEqual(3);
  });

  /**
   * The control. Without it there is no baseline for "what does it do with no
   * direction", which is the question P7.5 exists to answer.
   */
  it('keeps the underspecified control', () => {
    const bare = EVAL_BRIEFS.find((b) => b.id === 'underspecified');
    expect(bare).toBeTruthy();
    expect(bare!.prompt.length).toBeLessThan(40); // it must stay bare
  });

  it('states what each brief probes, so a result can be read', () => {
    for (const b of EVAL_BRIEFS) {
      expect(b.probes.length, `${b.id} has no stated purpose`).toBeGreaterThan(40);
      expect(b.prompt.trim().length, `${b.id} has no prompt`).toBeGreaterThan(0);
    }
  });
});
