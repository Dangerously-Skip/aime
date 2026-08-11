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
 * Overall 84.98 on 2026-08-11, so the ratchet moves 80 → 82. It is set two
 * points below rather than one because ~30 mutants here are killed by TIMEOUT,
 * and a loaded runner can turn a timeout into a survivor; a ratchet that goes
 * red on machine load is one people raise the threshold to silence.
 *
 * `private-address.ts` joined that day at 88.05 — the SSRF address predicates,
 * extracted from `mcp/url-guard.ts` so they could be measured as the control
 * they are. In that file their score was diluted by server-NAME derivation,
 * which is ordinary logic, and the combined number said nothing useful about
 * either half. An IPv4-mapped IPv6 literal had walked through every check.
 *
 * Scores by file, measured 2026-07-29:
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
  thresholds: ratchet(82),
};
