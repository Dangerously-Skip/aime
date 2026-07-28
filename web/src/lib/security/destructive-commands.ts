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
 * Pure and dependency-free, so the patterns are directly testable.
 */
import type { ApprovalQuestion } from '../mcp/tool-policy';

/** Tools that hand a raw command line to a shell. */
export const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell']);

interface Rule {
  pattern: RegExp;
  /** Shown on the card, so it reads as a reason rather than a regex. */
  reason: string;
}

/**
 * Ordered: the first match wins, so put the specific before the general.
 * `\b` boundaries are avoided where a command can be reached through a path
 * (`/bin/rm`) or a prefix (`sudo rm`).
 */
const RULES: Rule[] = [
  { pattern: /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, reason: 'a fork bomb' },
  { pattern: /\brm\s+(-\w*[rRf]\w*\s+)+/, reason: 'a recursive or forced delete' },
  { pattern: /\brm\s+[^|;&]*[*?]/, reason: 'a delete with a wildcard' },
  { pattern: /\brm\s+(-\S+\s+)*(\/|~)\S*/, reason: 'a delete by absolute path' },
  { pattern: /\b(mkfs|fdisk|diskutil|parted)\b/, reason: 'a disk or filesystem operation' },
  { pattern: /\bdd\s+.*\bof=/, reason: 'a raw write with dd' },
  { pattern: /\bshred\b/, reason: 'an unrecoverable overwrite' },
  { pattern: /(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba)?sh\b/, reason: 'piping a download straight into a shell' },
  { pattern: /\bbase64\s+(-\w+\s+)*(-d|--decode)\b[^|;&]*\|\s*(ba)?sh\b/, reason: 'executing decoded output' },
  { pattern: /\bsudo\b|\bdoas\b|\bsu\s+-/, reason: 'an escalation to root' },
  { pattern: /\bchmod\s+(-\S+\s+)*777\b/, reason: 'making something world-writable' },
  { pattern: /\b(chmod|chown)\s+(-\S+\s+)*-[rR]\b|\b(chmod|chown)\s+-\w*[rR]/, reason: 'a recursive permission change' },
  { pattern: /\bfind\b[^|;&]*\s-delete\b/, reason: 'a bulk delete via find' },
  { pattern: /\bfind\b[^|;&]*-exec\s+rm\b/, reason: 'a bulk delete via find' },
  { pattern: /\btruncate\s+(-\S+\s+)*-s\s*0/, reason: 'truncating a file to nothing' },
  { pattern: />\s*\/(etc|usr|bin|sbin|boot|System|Library)\b/, reason: 'a write into a system directory' },
  { pattern: /\b(rm|mv|cp)\b[^|;&]*\s\/(etc|usr|bin|sbin|boot|System)\b/, reason: 'touching a system directory' },
  { pattern: /\bgit\s+(push\b[^|;&]*\s(-f\b|--force(?!-with-lease))|reset\s+--hard|clean\s+-\w*[fd])/, reason: 'a destructive git operation' },
  { pattern: /\b(killall|pkill)\b/, reason: 'killing processes by name' },
  { pattern: /\bdrop\s+(table|database)\b/i, reason: 'dropping a database object' },
  { pattern: /\b(shutdown|reboot|halt)\b/, reason: 'a shutdown or reboot' },
  { pattern: /\bdefaults\s+delete\b|\blaunchctl\s+(unload|remove)\b/, reason: 'changing system configuration' },
  { pattern: /\bnpm\s+publish\b|\bgh\s+release\s+delete\b|\bgh\s+repo\s+delete\b/, reason: 'an irreversible public action' },
];

export interface CommandVerdict {
  destructive: boolean;
  /** Present when destructive — a phrase for the card, never a regex. */
  reason?: string;
}

/**
 * Does this command look destructive enough to be worth a human's attention?
 *
 * Tuned for recall (see the file header). A non-string, or anything unparseable,
 * is NOT reported destructive: this gate adds a prompt, so guessing "yes" on
 * garbage would train users to click through.
 */
export function classifyCommand(command: unknown): CommandVerdict {
  if (typeof command !== 'string' || !command.trim()) return { destructive: false };
  for (const rule of RULES) {
    if (rule.pattern.test(command)) return { destructive: true, reason: rule.reason };
  }
  return { destructive: false };
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
