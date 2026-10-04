import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { branchNameProblem, pushArgs } = require_('./git-args.js');

/**
 * `git:push` passed a renderer-supplied branch straight into git's argv. No
 * shell, but git parses its own options — `--receive-pack=<cmd>` runs a command
 * on push. The name is validated AND `--` precedes it; the second half is proven
 * against a real git and a real (local, bare) remote, not by reading the array.
 */

describe('branchNameProblem', () => {
  it.each(['main', 'feat/login', 'release-1.2', 'user/a_b', 'v1.0.0-rc.1'])('accepts %s', (b) => {
    expect(branchNameProblem(b)).toBeNull();
  });

  it.each([
    ['--receive-pack=touch /tmp/pwned', 'an option to git'],
    ['--mirror', 'an option to git'],
    ['-f', 'a short option'],
    ['feat login', 'whitespace'],
    ['feat\tlogin', 'a tab'],
    ['feat\nlogin', 'a newline'],
    ['a..b', 'a range'],
    ['a~1', 'a revision suffix'],
    ['a^', 'a revision suffix'],
    ['a:b', 'a refspec separator'],
    ['+main', 'a force refspec, which `--` does not neutralise'],
    ['a@{1}', 'a reflog selector'],
    ['a*', 'a glob'],
    ['a\\b', 'a backslash'],
    ['/abs', 'a leading slash'],
    ['trailing/', 'a trailing slash'],
    ['x.lock', 'a .lock suffix'],
    ['', 'empty'],
    ['x'.repeat(300), 'too long'],
  ])('rejects %j (%s)', (b) => {
    expect(branchNameProblem(b)).not.toBeNull();
  });

  it('rejects non-strings', () => {
    expect(branchNameProblem(undefined)).not.toBeNull();
    expect(branchNameProblem(['main'])).not.toBeNull();
  });
});

describe('pushArgs', () => {
  it('puts -- before the branch', () => {
    expect(pushArgs('main')).toEqual(['push', '-u', 'origin', '--', 'main']);
  });

  it('throws with the reason for a bad name', () => {
    expect(() => pushArgs('--mirror')).toThrow(/cannot start with '-'/);
  });
});

const hasGit = spawnSync('git', ['--version']).status === 0;

/**
 * The environment for a git that must act on the temp repos below and nothing
 * else: every inherited `GIT_*` variable is dropped.
 *
 * Git exports GIT_DIR (and friends) to its hooks, and the pre-push hook runs
 * this suite. With GIT_DIR inherited, `git init --bare remote.git` did not
 * create a temp repo — it RE-INITIALISED THE REAL ONE as bare, flipping
 * `core.bare = true` in the shared config and breaking every worktree of the
 * checkout, mid-push. cwd does not protect you: GIT_DIR wins over discovery.
 */
function isolatedGitEnv(env = process.env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('GIT_')));
  return { ...clean, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
}

describe.skipIf(!hasGit)('isolatedGitEnv', () => {
  it('a git run from inside a hook (GIT_DIR set) cannot touch the repo the hook belongs to', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'git-args-victim-'));
    try {
      const victim = path.join(root, 'victim');
      execFileSync('git', ['init', '-q', victim], { env: isolatedGitEnv() });
      const victimGitDir = path.join(victim, '.git');
      const hookEnv = { ...process.env, GIT_DIR: victimGitDir, GIT_WORK_TREE: victim };
      const scratch = path.join(root, 'scratch');
      mkdirSync(scratch);

      execFileSync('git', ['init', '-q', '--bare', 'remote.git'], { cwd: scratch, env: isolatedGitEnv(hookEnv) });

      const bare = execFileSync('git', ['config', '--get', 'core.bare'], { cwd: victim, env: isolatedGitEnv() });
      expect(bare.toString().trim()).toBe('false');
      expect(existsSync(path.join(scratch, 'remote.git', 'HEAD'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasGit)('against a real git and a real remote', () => {
  let dir;
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', env: isolatedGitEnv() }).toString();

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'git-args-'));
    git(dir, 'init', '-q', '--bare', 'remote.git');
    git(dir, 'init', '-q', 'work');
    const work = path.join(dir, 'work');
    writeFileSync(path.join(work, 'f.txt'), 'x');
    git(work, 'add', 'f.txt');
    git(work, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'x');
    git(work, 'branch', '-M', 'feat');
    git(work, 'remote', 'add', 'origin', path.join(dir, 'remote.git'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('pushes a normal branch and sets upstream', () => {
    const work = path.join(dir, 'work');
    git(work, ...pushArgs('feat'));
    expect(git(path.join(dir, 'remote.git'), 'branch', '--list', 'feat')).toContain('feat');
    expect(git(work, 'rev-parse', '--abbrev-ref', 'feat@{upstream}').trim()).toBe('origin/feat');
  });

  it('after --, an option-shaped name is a refspec, not an option — the command never runs', () => {
    const work = path.join(dir, 'work');
    const marker = path.join(dir, 'pwned');
    // Bypass the validator on purpose: this proves the SECOND lock on its own.
    const args = ['push', '-u', 'origin', '--', `--receive-pack=touch ${marker}`];
    const r = spawnSync('git', args, { cwd: work, stdio: 'pipe', env: isolatedGitEnv() });
    expect(r.status).not.toBe(0);
    expect(existsSync(marker)).toBe(false);

    // And without `--`, the same argument IS an option (the reason for the fix).
    spawnSync('git', ['push', `--receive-pack=touch ${marker}`, 'origin', 'feat'], {
      cwd: work,
      stdio: 'pipe',
      env: isolatedGitEnv(),
    });
    expect(existsSync(marker)).toBe(true);
  });
});
