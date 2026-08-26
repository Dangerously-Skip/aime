import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

/**
 * The release pipeline's Windows job died in postinstall: the script was a
 * shell chain — `cp … && mkdir -p … && cp …` — and cmd.exe has neither `cp`
 * nor `mkdir -p`, so `npm ci` failed and no Windows installer could ever
 * build. Everything now lives in scripts/postinstall.js (fs.* calls).
 *
 * These assertions hold the line: the package.json hook must delegate to a
 * node script, that script must exist, and the hook must never again embed
 * shell commands that only exist on Unix.
 */

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));

describe('postinstall is cross-platform', () => {
  it('delegates to a node script, not a shell chain', () => {
    const hook = pkg.scripts?.postinstall ?? '';
    expect(hook).toMatch(/node\s+scripts\/postinstall\.js/);
  });

  it('never embeds Unix-only commands in the hook', () => {
    const hook = pkg.scripts?.postinstall ?? '';
    // Word-boundary match so a future legit binary named e.g. `cp-something`
    // is not a false positive — the regression was bare `cp` and `mkdir -p`.
    expect(hook).not.toMatch(/\bcp\s/);
    expect(hook).not.toMatch(/\bmkdir\b/);
    expect(hook).not.toMatch(/\bmv\s/);
  });

  it('the script it delegates to exists', () => {
    expect(existsSync(path.join(root, 'scripts', 'postinstall.js'))).toBe(true);
  });
});
