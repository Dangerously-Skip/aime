import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAllowedWorkspaceRoot } from './workspace-root';

/**
 * Real directories and real symlinks, because the bug this fixes was entirely
 * about the difference between a path and the directory it names.
 *
 * The first real goal run was refused with a flat "Forbidden" for a folder in
 * /tmp. On macOS /tmp is a symlink to /private/tmp and the folder picker returns
 * the RESOLVED form, so `/private/tmp/x`.startsWith('/tmp/') was false — while a
 * curl to the same directory spelled `/tmp/x` sailed through.
 */
describe('isAllowedWorkspaceRoot', () => {
  it('allows a folder under the home directory', async () => {
    expect(await isAllowedWorkspaceRoot(path.join(os.homedir(), 'projects', 'x'))).toBe(true);
  });

  it('allows the home directory itself', async () => {
    expect(await isAllowedWorkspaceRoot(os.homedir())).toBe(true);
  });

  it('allows BOTH spellings of the same temp directory', async () => {
    // The regression. These are the same directory; only the spelling differs.
    const dir = fs.mkdtempSync(path.join('/tmp', 'wsroot-'));
    try {
      const real = await fsp.realpath(dir);
      expect(await isAllowedWorkspaceRoot(dir)).toBe(true);
      expect(await isAllowedWorkspaceRoot(real)).toBe(true);
      // And on macOS they genuinely differ, which is the whole point.
      if (process.platform === 'darwin') expect(real).not.toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows a folder that does not exist yet, under an allowed root', async () => {
    // A working folder may be created by the run itself; resolving must not
    // require it to exist first.
    expect(await isAllowedWorkspaceRoot(path.join(os.homedir(), 'not-created-yet', 'deep'))).toBe(true);
  });

  it('refuses system directories', async () => {
    for (const p of ['/etc', '/', '/usr/bin', '/System']) {
      expect(await isAllowedWorkspaceRoot(p), `${p} should be refused`).toBe(false);
    }
  });

  it('refuses an empty path', async () => {
    expect(await isAllowedWorkspaceRoot('')).toBe(false);
  });

  it('refuses a symlink that ESCAPES an allowed root', async () => {
    /*
     * Resolving both sides is what makes the check about the directory. It must
     * not become a way to reach /etc by pointing a link at it from /tmp.
     */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsroot-escape-'));
    try {
      const link = path.join(dir, 'out');
      fs.symlinkSync('/etc', link);
      expect(await isAllowedWorkspaceRoot(link)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a sibling whose name merely EXTENDS an allowed root', async () => {
    /*
     * `/Users/adamfoo` is not inside `/Users/adam`, but a prefix check without
     * the separator says it is.
     *
     * The first version of this test used `/tmpfoo`, which proved nothing: the
     * resolved root on macOS is `/private/tmp`, so `/tmpfoo` shares no prefix
     * with it and the case passed with the separator deleted. It has to extend a
     * root that is actually in the allowed list.
     */
    expect(await isAllowedWorkspaceRoot(os.homedir() + 'foo')).toBe(false);
    expect(await isAllowedWorkspaceRoot(os.homedir() + 'foo/deep')).toBe(false);
  });
});
