import { base, ratchet } from './stryker.base.mjs';

/**
 * Mutation testing for pure logic, where the failure mode is a VACUOUS TEST
 * rather than a security hole.
 *
 * WHY THIS EXISTS, separately from the security scope. Two tests written for
 * `artifactsFromMessages` asserted nothing: deleting the code they covered left
 * them green, because a second code path happened to produce the same answer.
 * They were caught by hand, and only because the habit of breaking the code on
 * purpose was already established — which is not a mechanism. Running the tool
 * found a third thing nobody had noticed: the dotfile filter existed in one of
 * two passes, so `.cache.pdf` was filtered by one and let back in by the other.
 *
 * WHAT BELONGS HERE. Pure functions whose output the UI or a downstream rule
 * depends on, where "the test passes" and "the test would notice" are easy to
 * confuse. Not the world: every file added slows a run people are already
 * unlikely to run, and a low-value file drags the ratchet.
 *
 *   npm run test:mutation:logic
 *
 * Measured 2026-08-11 (overall 80.6):
 *   resolve.ts           90.7%
 *   deck-format.ts       84.0%
 *   artifact-tracker.ts  79.4%  — most survivors are the extension REGEX TABLE
 *                                 and the sidebar-validity guards, both
 *                                 equivalent-mutant territory; see the note on
 *                                 `ratchet` in stryker.base.mjs
 */
export default {
  ...base,
  htmlReporter: { fileName: 'reports/mutation/logic/index.html' },
  mutate: [
    'src/lib/artifact-tracker.ts',
    'src/lib/themes/deck-format.ts',
    'src/lib/themes/resolve.ts',
  ],
  thresholds: ratchet(78),
};
