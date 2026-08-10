import { describe, it, expect } from 'vitest';
import { shellWriteOutside } from './shell-write-scope';

/**
 * The two writes that actually escaped, and everything that must not start
 * prompting because of them.
 *
 * `restrictToProjectFolder` covers the file tools and says so in its own
 * description. The gap was walked through twice in one session — a deck written
 * to the home directory, and four probe scripts written into the user's
 * repository — because the agent needed a destination and nothing said which
 * one. Both were shell writes, both silent.
 */

const CWD = '/tmp/aime-test-cwd';

describe('the writes that got out', () => {
  it('catches a deck redirected into the home directory', () => {
    const v = shellWriteOutside(
      'cat > /Users/adamwitanowski/first-advantage-verification.html << "EOF"',
      CWD,
    );
    expect(v.target).toBe('/Users/adamwitanowski/first-advantage-verification.html');
    expect(v.what).toBe('a redirect');
  });

  it('catches a script written into the source tree', () => {
    const v = shellWriteOutside(
      'echo "x" > /Users/adamwitanowski/conductor/workspaces/aime/web/src/lib/icloud/read-msg.test.ts',
      CWD,
    );
    expect(v.target).toContain('read-msg.test.ts');
  });

  it.each([
    ['tee /Users/x/out.txt', 'tee'],
    ['cat a | tee -a /Users/x/out.txt', 'tee'],
    ['cp deck.html /Users/x/deck.html', 'a copy or move'],
    ['mv deck.html /Users/x/', 'a copy or move'],
    ['echo hi >> /Users/x/log', 'a redirect'],
  ])('catches %s', (cmd, what) => {
    const v = shellWriteOutside(cmd, CWD);
    expect(v.target, `${cmd} was not caught`).not.toBeNull();
    expect(v.what).toBe(what);
  });
});

/**
 * A gate that fires on ordinary work is one people learn to click through —
 * the failure the destructive-command gate's own header warns about. These are
 * the cases that must stay silent.
 */
describe('ordinary work does not prompt', () => {
  it.each([
    'ls -la',
    'npm test',
    'cat package.json',
    'grep -rn "sudo" src/',
    // Relative paths are inside the working directory by construction.
    'echo x > out.txt',
    'cat a.txt > ./b.txt',
    // Temp files and the app's own scratch area are legitimate everywhere.
    'echo x > /tmp/scratch.txt',
    'cp a /var/folders/zz/T/x',
    'echo x > /Users/adamwitanowski/.aime/scratch/abc/images/y.png',
    'curl -s https://x.com > /dev/null',
    // Talking about a path is not writing to one.
    'echo "writing to /etc/hosts"',
    "git commit -m 'move config > /etc/app.conf'",
    // A file descriptor duplication is not a path.
    'make 2>&1 | tee build.log',
  ])('%s is allowed', (cmd) => {
    expect(shellWriteOutside(cmd, CWD).target, `${cmd} would prompt`).toBeNull();
  });

  it('allows writes inside the working directory, however deep', () => {
    expect(shellWriteOutside(`echo x > ${CWD}/a/b/c.txt`, CWD).target).toBeNull();
  });

  /** No working directory means no boundary to enforce; do not invent one. */
  it('does nothing without a cwd', () => {
    expect(shellWriteOutside('echo x > /Users/x/y', undefined).target).toBeNull();
  });
});

/**
 * The regexes are module-level and /g, so `lastIndex` carries between calls
 * unless it is reset — a stale index silently skips the start of the next
 * command, which is a gate that works once and then stops.
 */
describe('it does not go stale between commands', () => {
  it('catches the same command twice in a row', () => {
    const cmd = 'echo x > /Users/x/out.txt';
    expect(shellWriteOutside(cmd, CWD).target).not.toBeNull();
    expect(shellWriteOutside(cmd, CWD).target, 'the second call missed it').not.toBeNull();
  });

  it('catches a later form after an earlier one matched', () => {
    expect(shellWriteOutside('echo x > /Users/x/a', CWD).target).not.toBeNull();
    expect(shellWriteOutside('tee /Users/x/b', CWD).target).not.toBeNull();
  });
});

/**
 * Stated rather than implied: this reads the command as written. Anything
 * computed or indirect is invisible, and pretending otherwise would be the
 * "claim with no mechanism" this codebase keeps finding.
 */
describe('the limits are real', () => {
  it('cannot see a computed destination', () => {
    expect(shellWriteOutside('D=/Users/x; echo hi > "$D/out"', CWD).target).toBeNull();
  });

  it('cannot see through a program that writes on its own', () => {
    expect(shellWriteOutside('python -c "open(\'/Users/x/o\',\'w\')"', CWD).target).toBeNull();
  });
});
