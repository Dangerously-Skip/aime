import { base, ratchet } from './stryker.base.mjs';

/**
 * Mutation testing for the security surface.
 *
 * WHY THIS EXISTS. Four security controls shipped that did nothing, all four
 * with passing tests: the tests asserted a name had been filtered out of a list,
 * which was true and irrelevant. A green suite says the code ran; it does not
 * say the assertions would notice if the code stopped working. Mutation testing
 * is the only thing that tells those apart, and it caught every one of them (by
 * hand, before this config existed).
 *
 * WHY SCOPED. Mutating the whole repo is slow enough that nobody runs it, and a
 * check nobody runs is worth nothing. These are the files where a silent failure
 * is a security hole rather than a bug, and they are pure functions, so the run
 * is fast. Add to this list when you add a CONTROL; anything else belongs in
 * stryker.logic.mjs, which has its own ratchet and cannot drag this one down.
 *
 *   npm run test:mutation
 *
 * Overall 83.35 on 2026-08-11 — down from 84.6 because `shell-write-scope.ts`
 * joined the scope since, not because anything regressed. Still clear of the
 * 80 ratchet. Scores by file, measured 2026-07-29:
 *   settings.ts              92%
 *   path-containment.ts      92%
 *   tool-policy.ts           91%  — was 76; the decision store had no tests at all
 *   write-scope.ts           81%  — the rest is fs-dependent branches
 *   destructive-commands.ts  71%  — a REGEX TABLE (was 61); see `ratchet`
 *   tool-names.ts            69%  — one small regex, so few mutants that the
 *                                   percentage moves a long way per mutant
 */
export default {
  ...base,
  htmlReporter: { fileName: 'reports/mutation/security/index.html' },
  mutate: [
    'src/lib/security/**/*.ts',
    '!src/lib/security/**/*.test.ts',
    'src/lib/path-containment.ts',
    'src/lib/mcp/tool-policy.ts',
  ],
  thresholds: ratchet(80),
};
