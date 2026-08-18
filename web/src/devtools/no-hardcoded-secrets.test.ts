import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * A live FeedlyBackly key sat in `sidebar.tsx` and the proxy route for 575
 * commits and shipped in every client bundle. Nothing noticed, because nothing
 * was looking: `tsc`, eslint and 4,700 tests are all indifferent to a string
 * literal that happens to be a credential.
 *
 * It also survived a hand-rolled regex sweep of every blob in the object
 * database, which reported the history clean. That sweep only matched KNOWN
 * provider prefixes — sk-, ghp_, AKIA, xox — and `fb_` is not one. Entropy
 * detection found it in minutes. The lesson is the shape of the check, not the
 * key: an allowlist of famous prefixes says nothing about the next vendor.
 *
 * So this scans tracked source for two things:
 *   1. Known provider prefixes, which are cheap to check and worth catching.
 *   2. Any `NAME_KEY = '<long high-entropy literal>'` assignment, which is what
 *      the FeedlyBackly key actually looked like and what a prefix list misses.
 *
 * This matters more now than it did last week. In a private repo a committed key
 * is a mistake; in a public one it is indexed within minutes.
 */

const repoRoot = resolve(__dirname, '../../..');

/** Tracked, reviewable source — not build output, not lockfiles, not fixtures. */
function trackedSourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', 'web/src', 'web/*.js', '.githooks'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|js|mjs|cjs|json)$/.test(f) || f.startsWith('.githooks/'));
}

/*
 * The one file allowed to contain key-shaped strings: the redaction suite, whose
 * fixtures are the canonical AWS and GitHub DOCUMENTATION examples. Narrow on
 * purpose — an allowlist that grows is how this check dies.
 */
const FIXTURE_ALLOWLIST = new Set([
  'web/src/lib/mcp/secrets.test.ts',
  'web/src/devtools/no-hardcoded-secrets.test.ts',
]);

/* Built from fragments so this file does not match its own patterns. */
const PROVIDER_PREFIXES = [
  ['sk-ant-', 20],
  ['sk-or-v1-', 20],
  ['ghp' + '_', 30],
  ['gho' + '_', 30],
  ['github_pat' + '_', 40],
  ['xoxb-', 20],
  ['AKIA', 16],
] as const;

/** `SOMETHING_KEY = '<32+ chars of base62>'` — an assigned credential literal. */
const ASSIGNED_LITERAL =
  /(?:KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*['"`]([A-Za-z0-9_\-]{32,})['"`]/g;

describe('no hardcoded credentials in tracked source', () => {
  const files = trackedSourceFiles();

  it('finds source files to scan', () => {
    // Without this, a broken `git ls-files` would make every check below pass by
    // scanning nothing at all.
    expect(files.length).toBeGreaterThan(100);
  });

  it('contains no known provider key prefixes', () => {
    const hits: string[] = [];
    for (const f of files) {
      if (FIXTURE_ALLOWLIST.has(f)) continue;
      const text = readFileSync(resolve(repoRoot, f), 'utf8');
      for (const [prefix, minLen] of PROVIDER_PREFIXES) {
        const re = new RegExp(`${prefix}[A-Za-z0-9_\\-]{${minLen},}`);
        if (re.test(text)) hits.push(`${f}: ${prefix}…`);
      }
    }
    expect(hits, `hardcoded provider key(s):\n${hits.join('\n')}`).toEqual([]);
  });

  it('contains no assigned high-entropy credential literals', () => {
    /*
     * The FeedlyBackly shape: `const FEEDLYBACKLY_API_KEY = 'fb_WTvd…'`. No
     * recognisable prefix, so only the assignment pattern catches it. Reading
     * from process.env passes, which is the whole point.
     */
    const hits: string[] = [];
    for (const f of files) {
      if (FIXTURE_ALLOWLIST.has(f)) continue;
      const text = readFileSync(resolve(repoRoot, f), 'utf8');
      for (const m of text.matchAll(ASSIGNED_LITERAL)) {
        hits.push(`${f}: ${m[0].slice(0, 40)}…`);
      }
    }
    expect(hits, `assigned credential literal(s):\n${hits.join('\n')}`).toEqual([]);
  });

  it('the FeedlyBackly key specifically is gone from both call sites', () => {
    // A named regression test for the one that actually shipped, so the fix
    // cannot be quietly reverted without a red suite.
    for (const f of [
      'web/src/components/layout/sidebar.tsx',
      'web/src/app/api/feedlybackly/[...path]/route.ts',
    ]) {
      const text = readFileSync(resolve(repoRoot, f), 'utf8');
      expect(text, `${f} still hardcodes the key`).not.toMatch(/['"`]fb_[A-Za-z0-9]{20,}/);
      expect(text).toMatch(/process\.env\./);
    }
  });
});
