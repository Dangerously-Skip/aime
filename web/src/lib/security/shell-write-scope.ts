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
 * the last argument of `cp`/`mv` — and only when that destination is an ABSOLUTE
 * path outside the working directory. Anything computed, substituted, or piped
 * through another program is invisible to it.
 *
 * So it is a speed bump on the common case, not a sandbox. It is worth having
 * because the common case is what actually happened, twice, and because the
 * result is an approval prompt rather than a silent write. Anyone needing a real
 * boundary should turn the Bash tool off, which is a mechanism rather than a
 * heuristic.
 */

/** Where a shell command may name a destination we can actually see. */
const WRITE_FORMS: Array<{ pattern: RegExp; what: string }> = [
  // `> /abs/path`, `>> /abs/path`, `2> /abs/path`. Not `>&1`.
  { pattern: /(?:^|[\s;|&])\d?>{1,2}\s*(\/[^\s;|&>]+)/g, what: 'a redirect' },
  // `tee /abs/path`, `tee -a /abs/path`
  { pattern: /(?:^|[\s;|&])tee\s+(?:-\S+\s+)*(\/[^\s;|&]+)/g, what: 'tee' },
  // `cp a /abs/dir`, `mv a /abs/dir`, `install ... /abs/path`
  { pattern: /(?:^|[\s;|&])(?:cp|mv|install|rsync)\s+(?:-\S+\s+)*\S+\s+(\/[^\s;|&]+)/g, what: 'a copy or move' },
];

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
      const raw = m[1];
      if (!raw) continue;
      const target = canonicalise(raw);
      if (alwaysAllowed(target)) continue;
      if (target === root || target.startsWith(root + '/')) continue;
      return { target: raw, what };
    }
  }
  return { target: null };
}
