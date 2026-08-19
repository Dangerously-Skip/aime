import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * A ruleset on `main` now requires a pull request with `test` and `e2e` green,
 * so a red CI run genuinely blocks a merge. That was impossible while the repo
 * was private on a Free org — rulesets 403 there — and the hook was the only
 * gate in the interim.
 *
 * The drift this file catches survived that change. Server-side enforcement
 * checks that CI passed; it has no opinion on whether the local hook still runs
 * the same things CI does. Two silent failures, neither visible by reading
 * either file on its own:
 *
 *   1. CI grows a step the hook does not run. The hook then passes on work CI
 *      would have failed, which is the whole point of the hook inverted.
 *   2. The hook stops being runnable — not executable, or no longer calling
 *      verify — and every push sails through with no output anyone would miss.
 *
 * Both are drift between two files that no one edits together. Derived from
 * source rather than duplicated, on the same principle as
 * send-route-coverage.test.ts: a new CI step is covered without anyone
 * remembering this file exists.
 */

const repoRoot = resolve(__dirname, '../../..');
const ci = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const hookPath = resolve(repoRoot, '.githooks/pre-push');
const hook = readFileSync(hookPath, 'utf8');
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'web/package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** The npm commands CI's `test` job runs, excluding dependency install. */
function ciTestJobChecks(): string[] {
  const block = ci.slice(ci.indexOf('\n  test:'), ci.indexOf('\n  e2e:'));
  expect(block.length).toBeGreaterThan(0);
  return [...block.matchAll(/^\s*run:\s*(npm (?:run )?[\w:-]+)\s*$/gm)]
    .map((m) => m[1])
    .filter((c) => c !== 'npm ci');
}

describe('the pre-push hook runs everything CI would', () => {
  it('finds the checks in CI’s test job', () => {
    // Guards the parser itself: a regex that silently matches nothing would make
    // every assertion below vacuously true.
    const checks = ciTestJobChecks();
    expect(checks.length).toBeGreaterThanOrEqual(4);
    expect(checks).toContain('npm run build');
  });

  it('verify covers every check CI’s test job runs', () => {
    const verify = pkg.scripts.verify;
    expect(verify).toBeTypeOf('string');
    for (const check of ciTestJobChecks()) {
      expect(verify, `verify is missing CI's "${check}"`).toContain(check);
    }
  });

  it('keeps the build step, which typecheck and the unit suite cannot replace', () => {
    /*
     * A client component importing a module that reaches `fs` fails only in
     * `next build`. That shipped once — provider-manager.tsx → lib/models/
     * credentials → app-paths → fs — with tsc --noEmit and 2777 tests green.
     */
    expect(pkg.scripts.verify).toContain('npm run build');
  });
});

describe('the hook can actually run', () => {
  it('is executable', () => {
    // A hook without the execute bit is skipped by git in silence — the failure
    // mode here is not an error message, it is nothing at all.
    expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0);
  });

  it('invokes verify', () => {
    expect(hook).toMatch(/npm run --silent verify|npm run verify/);
  });

  it('runs from web/, where package.json lives', () => {
    expect(hook).toMatch(/cd "\$repo_root\/web"/);
  });

  it('fails the push when verify fails', () => {
    // `set -e` plus an `if !` that exits non-zero. A hook that reports a failure
    // and exits 0 is decoration.
    expect(hook).toMatch(/set -euo pipefail/);
    expect(hook).toMatch(/exit 1/);
  });
});

describe('the hook is opt-in, and stays that way', () => {
  it('installs by pointing core.hooksPath at the tracked directory', () => {
    expect(pkg.scripts['hooks:install']).toContain('core.hooksPath .githooks');
    expect(pkg.scripts['hooks:uninstall']).toContain('--unset core.hooksPath');
  });

  it('is NOT installed automatically by postinstall', () => {
    /*
     * Deliberate, and the reason is in the hook's own header: a hook that
     * installs itself behind your back is the fastest route to a reflexive
     * `--no-verify`, which is strictly worse than no hook. If someone "fixes"
     * discoverability by wiring this into postinstall, this fails and they can
     * read why here first.
     */
    expect(pkg.scripts.postinstall ?? '').not.toContain('hooks:install');
  });

  it('documents the escape hatch, rather than pretending there is none', () => {
    expect(hook).toContain('SKIP_VERIFY=1');
    expect(hook).toMatch(/--no-verify/);
  });
});
