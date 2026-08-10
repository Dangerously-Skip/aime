/**
 * Settings shared by every mutation-testing scope.
 *
 * There are two scopes, not one, because Stryker has a SINGLE global
 * `thresholds.break` and the two things we mutate deserve different bars:
 *
 *   - security  — a silent failure is a hole. High bar, and the ratchet must
 *                 not be draggable by unrelated code.
 *   - logic     — pure functions where a silent failure is a bug and the real
 *                 risk is a test that asserts nothing. Lower bar, still a ratchet.
 *
 * One config could not express that. Adding `artifact-tracker.ts` (74%) to the
 * security config would have pulled the overall score under the security bar
 * and turned a working weekly gate red — which is how a gate gets its threshold
 * lowered "temporarily", and then the security files lose their ratchet too.
 * Two scopes, two scores, two ratchets, and neither can move the other.
 *
 * Neither is a per-commit gate: mutation runs are slow, and a slow check on
 * every push is a check people learn to skip.
 */
export const base = {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  reporters: ['html', 'clear-text', 'progress'],
  coverageAnalysis: 'perTest',
  timeoutMS: 20000,
  concurrency: 4,
};

/**
 * `break` is a RATCHET, not a target: it sits just below the current score so a
 * regression in test strength fails the run, and it should be raised as the
 * score improves. Same stance the repo takes with lint (errors gated at 0,
 * warnings allowed with `lint:strict` as the local ratchet).
 *
 * Do not chase 100. A large share of survivors on a REGEX TABLE are equivalent
 * mutants — overlapping rules mean a neutered rule is still matched by another,
 * and widening a pattern changes nothing unless a real command starts matching.
 * Proof, measured on destructive-commands.ts: growing the "must not prompt"
 * corpus from 18 commands to 74 killed exactly ZERO extra mutants. Writing tests
 * to move that number is writing tests for the tool rather than for a bug.
 */
export const ratchet = (score) => ({ high: score + 10, low: score, break: score });
