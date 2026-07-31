/**
 * Recognise a shell command worth stopping to ask about — and build the card
 * that asks.
 *
 * ## Why this asks instead of blocking
 *
 * The setting behind it used to append a sentence to the system prompt ("NEVER
 * run destructive shell commands: rm -rf, sudo, …") and nothing else. That is a
 * request, not a control, and the honest fix is NOT to turn this list into a
 * blocklist: shell classification by pattern is unwinnable. `sh -c`,
 * `$(base64 -d <<<…)`, an alias, `env X=rm $X -rf`, `find . -delete`, a Python
 * one-liner — a blocklist catches the literal spelling and nothing else, and
 * users relax in proportion to what they think it stops. That is strictly worse
 * than a prompt line, because the prompt line does not claim to be a boundary.
 *
 * Routing the match to the human approval gate changes the cost of both errors:
 *
 *   - A false positive costs one click. So this list is deliberately BROAD —
 *     tuned for recall, not precision. Matching `git push --force` on a repo the
 *     user meant to force-push is fine.
 *   - A false negative is no worse than today, because the regex was never the
 *     last line of defence. The user is.
 *
 * That asymmetry is the whole design. Do not "improve" this by making it
 * stricter to reduce prompts, and do not let it become the only thing standing
 * between the agent and the disk.
 *
 * ## Two rule sets, one mechanism
 *
 * `RULES` is about damage to the machine; `NETWORK_RULES` is about reaching off
 * it. They are separate because they are behind separate user toggles, and
 * identical in every other respect — same recall bias, same approval gate, same
 * "this is not a boundary" caveat above. A caller asks for whichever sets the
 * user has enabled.
 *
 * Note that `curl … | sh` sits in `RULES`, not `NETWORK_RULES`: piping a
 * download into a shell is a way to destroy a machine and was caught long before
 * a network toggle existed. Nothing moved when the second set arrived, because
 * moving it would have silently stopped catching it for the many users who have
 * the destructive toggle on and the network one off.
 *
 * Pure and dependency-free, so the patterns are directly testable.
 */
import type { ApprovalQuestion } from '../mcp/tool-policy';

/** Tools that hand a raw command line to a shell. */
export const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell']);

interface Rule {
  pattern: RegExp;
  /** Shown on the card, so it reads as a reason rather than a regex. */
  reason: string;
  /**
   * Match against the RAW command rather than the quote-blanked one.
   *
   * Quoted text is blanked by default so prose cannot trip a rule — `git commit
   * -m "remove sudo from setup"` is not an escalation. But some dangerous
   * payloads only ever appear inside quotes, SQL being the obvious one:
   * `psql -c "DROP TABLE users"` has to be read through the quotes or it can
   * never be seen. Those rules opt in here.
   *
   * The cost is a false positive on `grep -r "DROP TABLE" docs/`, which is far
   * rarer than a commit message mentioning `sudo`, and cheap when the answer is
   * a prompt rather than a refusal.
   */
  raw?: true;
}

/**
 * Longest command we will classify. Beyond this we ask rather than scan.
 *
 * `classifyCommand` runs synchronously inside `canUseTool` on a model-controlled
 * string, so a regex that backtracks is a self-DoS on the single-threaded
 * server: the original `rm` rule was cleanly O(n²) — measured at 6ms for 2KB,
 * 618ms for 20KB and ~62s for 200KB — which stalls every SSE stream, cron tick
 * and API route, INCLUDING `/api/chat/answer`, the endpoint the approval card
 * needs to resolve. The patterns below are no longer ambiguous, and this cap is
 * the belt to that braces: a command too long to scan is treated as destructive,
 * because a 4KB one-liner deserves a human glance anyway.
 */
const MAX_SCANNED = 4096;

/**
 * Ordered: the first match wins, so put the specific before the general.
 * `\b` boundaries are avoided where a command can be reached through a path
 * (`/bin/rm`) or a prefix (`sudo rm`).
 *
 * Two rules for every pattern here:
 *
 * 1. **No ambiguous quantifiers.** Nothing of the form `(a*b*)+` or a greedy
 *    `.*`/`[^x]*` that another quantifier can also consume — that is what made
 *    the original quadratic. Prefer a bounded `{0,N}` or a negated class that
 *    cannot overlap its neighbour.
 * 2. **`[\s\S]` not `.`** when crossing a command. `.` does not match a newline
 *    without the `s` flag, so `dd if=/dev/zero \<newline> of=/dev/rdisk0` — an
 *    ordinary multi-line invocation — slipped past a rule its neighbours caught.
 */
const RULES: Rule[] = [
  { pattern: /:\s*\(\s*\)\s*\{[\s\S]{0,200}?\|[\s\S]{0,200}?&\s*\}\s*;/, reason: 'a fork bomb' },
  // Short flag cluster (-rf, -fr, -r) or the GNU long forms, which the original
  // single-dash-only pattern missed entirely: `rm --recursive --force build`.
  { pattern: /\brm\s+(?:-[a-zA-Z]{0,8}[rRf][a-zA-Z]{0,8}|--recursive|--force)\b/, reason: 'a recursive or forced delete' },
  { pattern: /\brm\s[^|;&\n]{0,200}[*?]/, reason: 'a delete with a wildcard' },
  { pattern: /\brm\s+(?:-{1,2}[a-zA-Z-]{1,20}\s+){0,4}[/~]/, reason: 'a delete by absolute path' },
  { pattern: /\b(mkfs|fdisk|diskutil|parted)\b/, reason: 'a disk or filesystem operation' },
  { pattern: /\bdd\s[\s\S]{0,200}?\bof=/, reason: 'a raw write with dd' },
  { pattern: /\bshred\b/, reason: 'an unrecoverable overwrite' },
  { pattern: /(curl|wget)\b[^|;&]{0,400}\|\s*(sudo\s+)?(ba)?sh\b/, reason: 'piping a download straight into a shell' },
  { pattern: /\bbase64\s(?:-[\w-]{1,20}\s){0,4}(?:-d|--decode)\b[^|;&]{0,400}\|\s*(ba)?sh\b/, reason: 'executing decoded output' },
  { pattern: /\bsudo\b|\bdoas\b|\bsu\s+-/, reason: 'an escalation to root' },
  { pattern: /\bchmod\s(?:-\S{1,20}\s){0,4}[0-7]?777\b/, reason: 'making something world-writable' },
  { pattern: /\b(?:chmod|chown)\s(?:-\S{1,20}\s){0,4}(?:-[a-zA-Z]{0,8}[rR]|--recursive)\b/, reason: 'a recursive permission change' },
  { pattern: /\bfind\b[^|;&]{0,400}\s-delete\b/, reason: 'a bulk delete via find' },
  { pattern: /\bfind\b[^|;&]{0,400}-exec\s+rm\b/, reason: 'a bulk delete via find' },
  { pattern: /\btruncate\s(?:-\S{1,20}\s){0,4}-s\s*0\b/, reason: 'truncating a file to nothing' },
  { pattern: />\s*\/(etc|usr|bin|sbin|boot|System|Library)\b/, reason: 'a write into a system directory' },
  { pattern: /\b(?:rm|mv|cp)\s[^|;&\n]{0,200}\s\/(?:etc|usr|bin|sbin|boot|System)\b/, reason: 'touching a system directory' },
  { pattern: /\bgit\s+(?:push\b[^|;&]{0,200}\s(?:-f\b|--force(?!-with-lease))|reset\s+--hard|clean\s+-[a-zA-Z]{0,8}[fd])/, reason: 'a destructive git operation' },
  { pattern: /\b(killall|pkill)\b/, reason: 'killing processes by name' },
  { pattern: /\bdrop\s+(table|database)\b/i, reason: 'dropping a database object', raw: true },
  { pattern: /\b(shutdown|reboot|halt)\b/, reason: 'a shutdown or reboot' },
  { pattern: /\bdefaults\s+delete\b|\blaunchctl\s+(unload|remove)\b/, reason: 'changing system configuration' },
  { pattern: /\bnpm\s+publish\b|\bgh\s+release\s+delete\b|\bgh\s+repo\s+delete\b/, reason: 'an irreversible public action' },
];

/**
 * Commands that reach the network in a way worth a glance. Same two regex rules
 * as `RULES` above (no ambiguous quantifiers, `[\s\S]` not `.`).
 *
 * Scoped to exfiltration and remote-shell shapes, NOT to network access as such.
 * The toggle's promise is that `npm install`, `pip install`, `git push` and
 * `brew` keep working, and a rule broad enough to catch "any command that opens a
 * socket" would prompt on all of them — which trains the click-through this whole
 * file exists to avoid.
 */
const NETWORK_RULES: Rule[] = [
  { pattern: /(?:^|[\s|;&(])(?:nc|ncat|netcat)\s/, reason: 'a netcat connection' },
  { pattern: /\bsocat\s/, reason: 'a socat relay' },
  // Uppercase-only, so `ssh host 'ls -l'` does not match. Quoted text is blanked
  // before the scan anyway, but the flags a tunnel needs are all capitals.
  { pattern: /\bssh\s[^|;&\n]{0,200}-[a-zA-Z]{0,8}[LRDW]\b/, reason: 'an SSH tunnel or port forward' },
  // `raw`: the payload only ever appears inside quotes —
  // `bash -c "echo hi > /dev/tcp/10.0.0.1/4444"` — so reading through the
  // quote-blanking is the only way to see it at all. Same reason as the SQL rule.
  { pattern: /\/dev\/(?:tcp|udp)\//, reason: 'a raw socket opened from the shell', raw: true },
  { pattern: /\b(?:ngrok|cloudflared|localtunnel|chisel)\b/, reason: 'exposing this machine through a tunnel' },
  { pattern: /\bcurl\b[^|;&\n]{0,400}(?:\s-T\b|\s--upload-file\b|\s-F\b|\s--form\b)/, reason: 'uploading a file' },
  // The remote spec must be the DESTINATION — the last argument of the segment.
  // `scp user@remote:/var/log/app.log ./` is a fetch, and prompting on a download
  // is noise that gets the toggle switched off. The lookahead ends the segment so
  // a chained `scp … user@h:/t && echo done` still matches.
  {
    pattern: /\b(?:scp|rsync)\s[^|;&\n]{0,200}[\w.-]{1,60}@[\w.-]{1,60}:[^\s|;&]{0,200}\s*(?=$|[;&|])/,
    reason: 'copying files to a remote host',
  },
  // The shell case is in RULES; these are the interpreters it does not cover.
  { pattern: /(?:curl|wget)\b[^|;&\n]{0,400}\|\s*(?:sudo\s+)?(?:python3?|perl|ruby|node|php)\b/, reason: 'piping a download into an interpreter' },
];

/** Which rule sets to scan — one per user toggle. */
export interface ClassifyOptions {
  /** `blockDangerousCommands`. Defaults on: the caller that omits it is a test. */
  destructive?: boolean;
  /** `blockNetworkCommands`. */
  network?: boolean;
}

export type CommandVerdict =
  | { ask: false }
  | {
      ask: true;
      /** A phrase for the card, never a regex. */
      reason: string;
      /** Which set matched, so the card can say why in the user's own terms. */
      category: 'destructive' | 'network';
    };

/**
 * Does this command look destructive enough to be worth a human's attention?
 *
 * Tuned for recall (see the file header). A non-string, or anything unparseable,
 * is NOT reported destructive: this gate adds a prompt, so guessing "yes" on
 * garbage would train users to click through.
 */
export function classifyCommand(
  command: unknown,
  opts: ClassifyOptions = { destructive: true },
): CommandVerdict {
  const sets: Array<[readonly Rule[], 'destructive' | 'network']> = [];
  if (opts.destructive) sets.push([RULES, 'destructive']);
  if (opts.network) sets.push([NETWORK_RULES, 'network']);
  if (sets.length === 0) return { ask: false };

  if (typeof command !== 'string' || !command.trim()) return { ask: false };

  // Too long to scan safely — ask instead of grinding. This runs on the request
  // thread, so an unbounded scan is a denial of service, and erring towards the
  // prompt is the whole design (see the header).
  if (command.length > MAX_SCANNED) {
    return { ask: true, reason: 'an unusually long command', category: sets[0][1] };
  }

  // Match against the command with quoted literals blanked out. `git commit -m
  // "remove sudo from setup"` and `grep -rn "sudo" src/` are not escalations,
  // and prompting on them is how a gate gets clicked through without reading —
  // the failure mode this file's header calls the one that matters. The blanking
  // preserves length and structure so nothing else shifts.
  const scannable = blankQuoted(command);
  for (const [rules, category] of sets) {
    for (const rule of rules) {
      if (rule.pattern.test(rule.raw ? command : scannable)) {
        return { ask: true, reason: rule.reason, category };
      }
    }
  }
  return { ask: false };
}

/**
 * Replace the CONTENTS of quoted runs with a filler character, keeping the
 * quotes and the length.
 *
 * Only balanced quotes are blanked; an unterminated quote is left alone, so a
 * command that opens a quote and never closes it cannot hide the rest of itself
 * from every rule.
 */
export function blankQuoted(command: string): string {
  return command.replace(/'[^']*'|"[^"]*"/g, (m) => m[0] + 'x'.repeat(m.length - 2) + m[0]);
}

/** Longest command we will render on a card, so a huge one-liner can't fill the UI. */
const MAX_SHOWN = 300;

/**
 * The approval card for a shell command.
 *
 * Offers **Allow once / Deny only**, unlike the MCP gate. A remembered "always
 * allow" keyed on a tool name would be a standing approval for every future
 * `rm -rf`, which is precisely the thing the user turned this on to prevent —
 * and unlike an MCP tool, the risk here lives in the argument, not the name.
 */
export function buildCommandApprovalQuestion(command: string, reason: string): ApprovalQuestion {
  const shown = command.length > MAX_SHOWN ? `${command.slice(0, MAX_SHOWN)}…` : command;
  return {
    header: 'Approval — destructive command',
    question: `Run this command? It looks like ${reason}.\n\n${shown}`,
    options: [
      { label: 'Allow once', description: 'Run it now. You will be asked again next time.' },
      { label: 'Deny', description: 'Do not run it. The agent is told and carries on.' },
    ],
    multiSelect: false,
  };
}
