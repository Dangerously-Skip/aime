import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { EVAL_BRIEFS, BRIEF_IDS, FROZEN_BRIEF_IDS } from './eval-briefs';

/**
 * The brief set is a measuring instrument, so the properties that make a
 * before/after comparison valid are asserted rather than assumed.
 *
 * The one that matters most is stability: artifacts are filed under `id`, so a
 * rename or a renumber silently detaches every stored "before" from its "after"
 * and the comparison quietly becomes meaningless rather than failing.
 *
 * The id list used to be pinned here as an exact array, which broke the moment
 * the set was extended from eight briefs to sixteen — and pinning it again would
 * mean every future addition edits the assertion that exists to catch edits.
 * What actually needs freezing is narrower: the briefs that already have stored
 * baseline runs, and specifically their PROMPT BYTES. Adding is safe; editing is
 * what invalidates history.
 */

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * Recorded when the baseline artifacts were captured (2026-08-01). A failure
 * here is not necessarily a bug — it means the stored `.planning/evals` runs for
 * that brief are no longer comparable, so either the edit goes or the history
 * does. Make that call explicitly; do not update the hash to make it pass.
 */
const FROZEN_PROMPT_HASHES: Record<string, string> = {
  'dashboard-ops': '11c2145c556ca48c',
  'marketing-saas': '163d2f2458cead39',
  'data-table': '159016b9debc432a',
  'form-onboarding': '0e5e85773ee20ca6',
  'mobile-screen': '611dd81906c4b9a2',
  'dark-app-shell': '8f401be32a64681c',
  'slide-deck': '70eeb5ef41ba4eef',
  'underspecified': '74e73a411fe649e4',
};

describe('the brief set is stable', () => {
  it.each(FROZEN_BRIEF_IDS)('%s still exists', (id) => {
    expect(
      EVAL_BRIEFS.find((b) => b.id === id),
      `${id} was removed; its stored artifacts now reference nothing`,
    ).toBeDefined();
  });

  it.each(FROZEN_BRIEF_IDS)('%s prompt is byte-identical to the baseline run', (id) => {
    const brief = EVAL_BRIEFS.find((b) => b.id === id)!;
    expect(
      hash(brief.prompt),
      `${id}'s prompt changed. Every stored comparison for it is now invalid — ` +
        `add a NEW brief with a new id rather than editing this one.`,
    ).toBe(FROZEN_PROMPT_HASHES[id]);
  });

  it('the frozen list and the hash table agree', () => {
    expect([...FROZEN_BRIEF_IDS].sort()).toEqual(Object.keys(FROZEN_PROMPT_HASHES).sort());
  });

  it('has unique ids', () => {
    expect(new Set(BRIEF_IDS).size).toBe(BRIEF_IDS.length);
  });

  /**
   * `shape` is explicitly NOT frozen — it is never sent to the model, so
   * reclassifying one changes how a result reads, not what was measured. This
   * asserts the distinction holds: the thing that reaches the model is the
   * prompt, and nothing else in the record is.
   */
  it('only the prompt is sent to the model', () => {
    const brief = EVAL_BRIEFS[0];
    expect(Object.keys(brief).sort()).toEqual(['id', 'probes', 'prompt', 'shape']);
  });
});

describe('the set is large enough to conclude something', () => {
  /**
   * The reason for going to sixteen. Samples of one brief are correlated, so
   * effective sample size is bounded by the BRIEF count — three samples of eight
   * briefs has an effective n around twelve, and adding samples does not move it.
   */
  it('has at least sixteen briefs', () => {
    expect(EVAL_BRIEFS.length).toBeGreaterThanOrEqual(16);
  });
});

describe('the set covers the shapes where the default style diverges', () => {
  it.each(['app', 'marketing', 'data', 'deck', 'print', 'document'])(
    'has at least one %s brief',
    (shape) => {
      expect(EVAL_BRIEFS.filter((b) => b.shape === shape).length).toBeGreaterThan(0);
    },
  );

  /**
   * The hole the second eight filled. Decks, print and email are different media
   * with different rules; a craft claim only ever tested on web pages is a claim
   * about web pages.
   */
  it('non-screen media are more than a token single brief', () => {
    const nonScreen = EVAL_BRIEFS.filter((b) => ['deck', 'print', 'document'].includes(b.shape));
    expect(nonScreen.length).toBeGreaterThanOrEqual(4);
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
