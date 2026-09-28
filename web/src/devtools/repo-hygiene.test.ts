import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/*
 * Two throwaway files sat tracked at the root of `web/` for months: a March
 * `tsc` transcript (`tsc_output.txt`, errors long since fixed) and a one-off
 * Electron origin probe (`zz-origin.mjs`). Neither was referenced by anything.
 * In a public repo they read as current — a contributor opening the first one
 * reasonably concludes the project does not typecheck.
 *
 * Scratch output belongs in `.context/` or a temp dir. This names the shapes
 * scratch files actually took here, so the next one fails review in CI rather
 * than surviving until someone happens to `ls`.
 */

const repoRoot = resolve(__dirname, '../../..');

const SCRATCH_SHAPES: RegExp[] = [
  /_output\.txt$/, // redirected tool output
  /\.log$/, // any log
  /^web\/zz-/, // "sort me last" probe scripts
];

describe('repo hygiene', () => {
  it('tracks no scratch output or probe scripts', () => {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean);

    const offenders = tracked.filter((f) => SCRATCH_SHAPES.some((re) => re.test(f)));
    expect(offenders).toEqual([]);
  });
});
