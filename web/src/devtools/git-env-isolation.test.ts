import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

/**
 * Run from the pre-push hook, the suite inherited GIT_DIR, and tests that shell
 * out to git acted on the real repository (see vitest.config.ts). This only
 * proves anything when the suite is started with those variables set — which is
 * exactly how the hook starts it.
 */
describe('tests never see repo-local git variables', () => {
  it('none is set in the test process', () => {
    const local = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(local).toContain('GIT_DIR');
    expect(local.filter((name) => name in process.env)).toEqual([]);
  });
});
