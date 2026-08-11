import path from 'path';
import { homedir } from 'os';
import { blankQuoted } from './destructive-commands';
import { canonicalise } from './write-scope';

/**
 * Shell commands that write outside the working directory.
 *
 * `restrictToProjectFolder` governs the file TOOLS. Its description says so —
 * "Shell commands can still write anywhere" — so the toggle has never lied. But
 * the hole is not theoretical, and it was walked through twice in one session:
 *
 *   - a deck written to `~/first-advantage-verification.html`, with its images
 *     left behind in the scratch directory, so every picture in it was broken
 *   - four probe scripts written into the user's REPOSITORY, one of them
 *     hand-rolling AES-256-GCM decryption of `~/.aime/credentials.enc`, because
 *     the mail tools were unavailable and the agent improvised
 *
 * Neither was malicious and neither was blocked. Both are the same shape: the
 * agent needed somewhere to put a file and chose a path nobody sanctioned.
 *
 * ## What this can and cannot do
 *
 * Shell is not parseable by regex and this does not pretend otherwise. It looks
 * for the ordinary ways a command names a destination — a redirect, `tee`, and
 * the last argument of `cp`/`mv` — and resolves it: absolute as written, `~` and
 * `$HOME` expanded, relative against the working directory. Anything COMPUTED
 * (`$D/out`, a command substitution) or written by a program the shell merely
 * launched is invisible, and reported as invisible rather than guessed at.
 *
 * That resolution is the fix for the first version of this file, which required
 * a literal leading `/` and so missed `~/deck.html` — which is, verbatim, the
 * first incident listed above. It caught the absolute spelling of the exact
 * write it was written for and nothing else.
 *
 * So it is a speed bump on the common case, not a sandbox. It is worth having
 * because the common case is what actually happened, twice, and because the
 * result is an approval prompt rather than a silent write. Anyone needing a real
 * boundary should turn the Bash tool off, which is a mechanism rather than a
 * heuristic.
 */

/**
 * Where a shell command may name a destination we can actually see.
 *
 * Each captures the destination TOKEN, not a path shape. The first version of
 * this file captured `(\/…)` — a literal leading slash — which meant it saw
 * only fully absolute destinations and missed:
 *
 *     echo x > ~/deck.html          the home directory, and VERBATIM the
 *                                   incident quoted in this file's header
 *     echo x > $HOME/deck.html      the same thing spelled differently
 *     echo x > ../../deck.html      out of the working directory by relative path
 *     echo x > "/Users/me/a b.html" a path with a space, which MUST be quoted
 *
 * The last one is the worst of the four: the scan runs on `blankQuoted`, so a
 * quoted destination was invisible to a pattern that then required a `/` where
 * the quote was. That is not an exotic evasion — it is how anyone writes a path
 * containing a space.
 *
 * The `d` flag is load-bearing. Matching happens on the BLANKED command (so an
 * operator inside quotes stays hidden), and `m.indices[1]` is then used to read
 * the real destination out of the original string at the same offsets. Blanking
 * preserves length precisely so this works.
 */
const DEST = String.raw`("[^"]*"|'[^']*'|[^\s;|&>]+)`;
const WRITE_FORMS: Array<{ pattern: RegExp; what: string }> = [
  // `> path`, `>> path`, `2> path`. Not `>&1`.
  { pattern: new RegExp(String.raw`(?:^|[\s;|&])\d?>{1,2}\s*(?!&)${DEST}`, 'gd'), what: 'a redirect' },
  // `tee path`, `tee -a path`
  { pattern: new RegExp(String.raw`(?:^|[\s;|&])tee\s+(?:-\S+\s+)*${DEST}`, 'gd'), what: 'tee' },
  // `cp a dest`, `mv a dest`, `install … dest`
  {
    pattern: new RegExp(String.raw`(?:^|[\s;|&])(?:cp|mv|install|rsync)\s+(?:-\S+\s+)*\S+\s+${DEST}`, 'gd'),
    what: 'a copy or move',
  },
];

/**
 * The absolute path a destination token denotes, or null when it cannot be
 * known from the text.
 *
 * Returning null for anything computed is the honest answer and matches what
 * this module claims: it reads the command AS WRITTEN. `$D/out` where `D` was
 * assigned earlier is genuinely invisible, and pretending otherwise would be the
 * "claim with no mechanism" this codebase keeps finding. `$HOME` is the one
 * exception because it is not really a variable — it is a fixed location that
 * every shell sets, and it is one of the two ways the motivating incident was
 * actually written.
 */
function resolveDestination(raw: string, cwd: string): string | null {
  let p = raw.trim();
  if (
    (p.startsWith('"') && p.endsWith('"') && p.length > 1) ||
    (p.startsWith("'") && p.endsWith("'") && p.length > 1)
  ) {
    p = p.slice(1, -1);
  }
  if (!p) return null;

  if (p === '~' || p.startsWith('~/')) p = homedir() + p.slice(1);
  else if (p === '$HOME' || p.startsWith('$HOME/')) p = homedir() + p.slice('$HOME'.length);
  else if (p === '${HOME}' || p.startsWith('${HOME}/')) p = homedir() + p.slice('${HOME}'.length);

  // Anything still carrying a substitution is not readable from the text.
  if (/[$`]/.test(p)) return null;
  // A relative destination is resolved against the working directory, which is
  // what makes `../../deck.html` visible as an escape rather than a filename.
  return canonicalise(path.isAbsolute(p) ? p : path.join(cwd, p));
}

/**
 * Paths every session legitimately writes to regardless of the working
 * directory. Without these, ordinary work — a temp file, the app's own scratch
 * area — would prompt, and a gate that prompts constantly is one people learn to
 * click through, which is the failure this codebase's command gate already warns
 * about.
 */
function alwaysAllowed(target: string): boolean {
  /*
   * Checked with the `/private` prefix stripped, because `canonicalise`
   * resolves symlinks and on macOS `/tmp` IS `/private/tmp` and `/var/folders`
   * IS `/private/var/folders`. Comparing only the literal forms meant every
   * ordinary temp-file write was flagged — a gate that fires on `echo x >
   * /tmp/f` is one people learn to click through, which is the failure this is
   * supposed to avoid.
   */
  const p = target.startsWith('/private/') ? target.slice('/private'.length) : target;
  return (
    p.startsWith('/tmp/') ||
    p.startsWith('/var/folders/') ||
    p.includes('/.aime/scratch/') ||
    p.startsWith('/dev/')
  );
}

export interface ShellWriteVerdict {
  /** The first out-of-scope destination found, or null. */
  target: string | null;
  /** How the command named it, for the prompt. */
  what?: string;
}

/**
 * @param command the shell command as written.
 * @param cwd the working directory the session is confined to.
 */
export function shellWriteOutside(command: unknown, cwd: string | undefined): ShellWriteVerdict {
  if (typeof command !== 'string' || !command.trim() || !cwd) return { target: null };

  // Quoted runs are blanked for the same reason the destructive gate blanks
  // them: `echo "writing to /etc/hosts"` is talk, not a write.
  const scannable = blankQuoted(command);
  const root = canonicalise(cwd);

  for (const { pattern, what } of WRITE_FORMS) {
    // The regexes are /g and module-level, so lastIndex must not carry between
    // calls — a stale index silently skips the start of the next command.
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(scannable)) !== null) {
      // Matched on the BLANKED text so an operator inside quotes stays hidden;
      // read back from the ORIGINAL so a quoted destination is still visible.
      const span = m.indices?.[1];
      if (!span) continue;
      const raw = command.slice(span[0], span[1]);
      if (!raw) continue;

      const target = resolveDestination(raw, root);
      // Not knowable from the text. Stated as a limit rather than guessed at.
      if (!target) continue;
      if (alwaysAllowed(target)) continue;
      if (target === root || target.startsWith(root + path.sep)) continue;
      return { target: raw, what };
    }
  }
  return { target: null };
}
