/**
 * Approval policy — C3. What may an unattended run do without asking?
 *
 * The mechanism (canUseTool interception) has existed all along; this supplies
 * the missing POLICY. It replaces a hardcoded ten-name tool list with a
 * classifier, because MCP tools have arbitrary names and a fixed list is wrong
 * the day a new connector is added.
 *
 * The classification question is narrow: does this call have side effects on
 * the world OUTSIDE the app? Reading is free. Acting inside the app (creating a
 * card, scheduling a reminder, asking the user) is visible in the UI and
 * reversible there, so it is not gated. Sending, deleting, publishing, paying,
 * writing files and running arbitrary shell commands are the calls a human
 * would want to see before an unattended agent makes them.
 *
 * Pure and heavily tested — this is a security-relevant classifier, so unknown
 * inputs FAIL CLOSED under a gating policy.
 */
import type { ApprovalPolicy } from './types';

export type ToolClass =
  /** Reads state, nothing changes: Read, Grep, list/get/search MCP tools. */
  | 'read'
  /** Acts inside the app; visible and reversible in the UI. */
  | 'app'
  /** Side effects on the world outside the app. */
  | 'consequential'
  /** Cannot tell. Treated as consequential under a gating policy. */
  | 'unknown';

/** Exact-name classes for the built-in toolset. */
const BUILTIN: Record<string, ToolClass> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  WebSearch: 'read',
  WebFetch: 'read',
  TodoWrite: 'app',
  Task: 'app',
  Skill: 'app',
  AskUserQuestion: 'app',
  canvas: 'app',
  spawn_agent: 'app',
  CronCreate: 'app',
  StandingOrderCreate: 'app',
  NotebookEdit: 'consequential',
  Write: 'consequential',
  Edit: 'consequential',
  // Bash is classified by its command, not its name — see classifyBash.
};

/** Verb prefixes that read. Matched against the tool name's last segment. */
const READ_VERBS = /^(get|list|read|search|fetch|find|query|describe|view|show|check|lookup|count|watch)([_-]|$)/i;

/**
 * Verb prefixes that act on the world. Includes payments and bookings — the
 * expensive mistakes — ahead of the obvious create/send/delete family.
 */
const CONSEQUENTIAL_VERBS =
  /^(send|post|create|update|delete|remove|publish|deploy|write|edit|upload|merge|submit|pay|purchase|buy|book|order|cancel|approve|reject|archive|move|rename|set|add|invite|schedule|reply|forward|transfer|execute|run|trigger|kill|restart|stop|start|apply|patch|push|revoke|grant|assign|close|reopen|label|comment)([_-]|$)/i;

/** The tool's own name with any MCP server prefix stripped. */
export function baseToolName(toolName: string): string {
  if (toolName.includes('__')) return toolName.split('__').pop()!;
  if (toolName.includes(':')) return toolName.split(':').pop()!;
  return toolName;
}

// ── Bash ──────────────────────────────────────────────────────────────────

/** Binaries whose plain invocation only reads. */
const READ_ONLY_BINARIES = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'fgrep',
  'find', 'fd', 'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'file', 'stat',
  'pwd', 'whoami', 'id', 'hostname', 'uname', 'date', 'env', 'printenv',
  'which', 'type', 'echo', 'printf', 'basename', 'dirname', 'realpath',
  'du', 'df', 'ps', 'top', 'uptime', 'jq', 'yq', 'tree', 'md5', 'md5sum',
  'shasum', 'sha256sum', 'awk', 'sed', 'column', 'nl', 'od', 'xxd', 'strings',
]);

/** git subcommands that only read. Anything else (push, commit, …) acts. */
const GIT_READ_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'branch', 'blame', 'describe',
  'rev-parse', 'ls-files', 'ls-remote', 'remote', 'shortlog', 'reflog', 'tag',
]);

/**
 * Classify a shell command. Deliberately conservative: a command is 'read' only
 * when EVERY pipeline segment starts with a known read-only binary and the
 * command contains no redirection or substitution. Everything else —
 * including anything we can't parse — is consequential, because Bash is
 * arbitrary code execution and a misclassified `rm` is unrecoverable while a
 * misclassified `ls` merely asks for an approval it didn't need.
 */
export function classifyBash(command: unknown): ToolClass {
  if (typeof command !== 'string' || !command.trim()) return 'unknown';
  const text = command.trim();

  // Redirection, substitution or background execution ⇒ side effects (or the
  // ability to smuggle them). `>` also catches `>>`.
  if (/[><]|\$\(|`|&\s*$/.test(text)) return 'consequential';

  // Every segment of a pipeline / command list must independently read.
  const segments = text.split(/\|\||&&|;|\|/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return 'unknown';

  for (const segment of segments) {
    // Strip leading env assignments (FOO=bar cmd …).
    const words = segment.split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    const bin = words[0]?.toLowerCase();
    if (!bin) return 'consequential';

    if (bin === 'git') {
      const sub = words[1]?.toLowerCase();
      if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) return 'consequential';
      continue;
    }
    if (!READ_ONLY_BINARIES.has(bin)) return 'consequential';
  }
  return 'read';
}

// ── Classification ────────────────────────────────────────────────────────

export function classifyToolCall(toolName: string, input?: Record<string, unknown>): ToolClass {
  const name = baseToolName(toolName);

  if (name === 'Bash') return classifyBash(input?.command);

  const exact = BUILTIN[name];
  if (exact) return exact;

  // Browser inspection tools read the page; browser interaction acts on it,
  // but only inside the app's own browser surface — 'app' either way.
  if (name.startsWith('browser_')) return 'app';

  if (READ_VERBS.test(name)) return 'read';
  if (CONSEQUENTIAL_VERBS.test(name)) return 'consequential';
  return 'unknown';
}

// ── Policy ────────────────────────────────────────────────────────────────

export interface ApprovalOutcome {
  allow: boolean;
  /** User-facing when denied. Honest: nothing is auto-created on their behalf. */
  reason?: string;
  class: ToolClass;
}

/**
 * Evaluate a tool call under a policy.
 *
 * - 'never'         → everything is allowed (interactive sessions, where the
 *                      human is watching the stream and can abort).
 * - 'consequential' → reads and in-app actions run; world-side effects and
 *                      unknowns pause. Unknown fails closed: a gating policy
 *                      that guesses "probably fine" is not a gate.
 * - 'always'        → only reads run; even in-app actions pause.
 */
export function evaluateApproval(
  policy: ApprovalPolicy,
  toolName: string,
  input?: Record<string, unknown>,
): ApprovalOutcome {
  const cls = classifyToolCall(toolName, input);
  if (policy === 'never') return { allow: true, class: cls };

  const gated =
    policy === 'always' ? cls !== 'read' : cls === 'consequential' || cls === 'unknown';

  if (!gated) return { allow: true, class: cls };

  return {
    allow: false,
    class: cls,
    reason:
      `${baseToolName(toolName)} was not run: this is an unattended execution and the tool ` +
      `${cls === 'unknown' ? 'could not be classified as safe' : 'has effects outside the app'}. ` +
      `Describe what you would have done instead. The user can run this goal interactively, ` +
      `or set its approval policy to allow it unattended.`,
  };
}
