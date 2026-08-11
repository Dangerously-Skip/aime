import { describe, it, expect } from 'vitest';
import os from 'os';
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

/**
 * The forms the first version of this file could not see.
 *
 * It captured `(\/…)` — a literal leading slash — so it caught the ABSOLUTE
 * spelling of the incident in its own header and missed every other way of
 * writing the same destination. Found by review, not by these tests, which is
 * the point: the original suite asserted the cases the pattern was built from.
 */
describe('destinations that are not spelled with a leading slash', () => {
  const HOME = os.homedir();

  it('catches the home directory written with a tilde', () => {
    const v = shellWriteOutside('cat > ~/first-advantage-verification.html << "EOF"', CWD);
    expect(v.target, 'the motivating incident walked through').not.toBeNull();
    expect(v.what).toBe('a redirect');
  });

  it.each([
    ['echo x > $HOME/out.txt', '$HOME'],
    ['echo x > ${HOME}/out.txt', '${HOME}'],
    ['tee ~/out.txt', 'tilde with tee'],
    ['cp deck.html ~/deck.html', 'tilde with cp'],
  ])('catches %s (%s)', (cmd) => {
    expect(shellWriteOutside(cmd, CWD).target, `${cmd} was allowed`).not.toBeNull();
  });

  it('catches a relative path that climbs out of the working directory', () => {
    expect(shellWriteOutside('echo x > ../../deck.html', CWD).target).not.toBeNull();
  });

  it('catches a quoted destination, which is how a path with a space is written', () => {
    const v = shellWriteOutside(`echo x > "${HOME}/my deck.html"`, CWD);
    expect(v.target, 'a quoted path was invisible to the scan').not.toBeNull();
  });

  it.each([
    `cat x | tee "${'${HOME}'}/y.txt"`,
    `cp a '${HOME}/b.txt'`,
  ])('catches the quoted form of %s', (cmd) => {
    expect(shellWriteOutside(cmd, CWD).target, `${cmd} was allowed`).not.toBeNull();
  });

  /*
   * The complement. Every one of these resolves INSIDE the working directory,
   * and a gate that fires on them is one people learn to click through — the
   * failure the destructive-command gate's own header warns about.
   */
  it.each([
    'echo x > out.txt',
    'echo x > ./b.txt',
    'echo x > sub/dir/c.txt',
    'echo x > ../santo-domingo-test-cwd-sibling/../aime-test-cwd/inside.txt',
    'make 2>&1 | tee build.log',
    'cp a.txt b.txt',
    'echo "writing to ~/etc/hosts"',
    "git commit -m 'moved it to ~/archive'",
  ])('%s stays silent', (cmd) => {
    expect(shellWriteOutside(cmd, CWD).target, `${cmd} would prompt`).toBeNull();
  });

  /*
   * A computed path that ALSO climbs out is where the "can I see this" check
   * earns its place. Without it, `../$D/out` resolves to a literal directory
   * named `$D` above the working directory, and the user gets an approval
   * prompt naming a destination that does not exist and was never going to be
   * written — a gate crying wolf about its own parse failure.
   */
  it('does not invent a target for a computed path that climbs out', () => {
    // Two levels, not one: CWD sits under /tmp, and /tmp is always allowed, so
    // a single `..` lands somewhere permitted and proves nothing either way.
    const v = shellWriteOutside('D=zz; echo hi > ../../$D/out.txt', CWD);
    expect(v.target, `prompted about ${v.target}, which is a parse artefact`).toBeNull();
  });

  it('does not invent a target for a command substitution that climbs out', () => {
    expect(shellWriteOutside('echo hi > "../../$(cat where.txt)/out"', CWD).target).toBeNull();
  });

  it('still says nothing it cannot actually see', () => {
    // A variable assigned earlier in the same command is not readable from the
    // text, and claiming otherwise would be a guess dressed as a check.
    expect(shellWriteOutside('D=/Users/x; echo hi > "$D/out"', CWD).target).toBeNull();
    expect(shellWriteOutside('echo hi > "$(cat where.txt)"', CWD).target).toBeNull();
  });
});
