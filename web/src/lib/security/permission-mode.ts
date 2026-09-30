import * as path from 'path';
import { classifyToolCall, baseToolName } from '../runs/approval';
import { resolveWithinTree } from '../path-containment';
import { BROWSER_TOOL_NAMES } from '../browser-tools';
import type { ApprovalQuestion } from '../mcp/tool-policy';
import type { CodePermissionMode } from '../surfaces/code-permission-mode';
import { SHELL_TOOLS } from './destructive-commands';
import { shellWriteOutside } from './shell-write-scope';
import { toolMatches } from './tool-names';
import { canonicalise, isFileWriteTool, writeTargetOf } from './write-scope';

/**
 * What each of Code's permission modes means, as a decision on one tool call.
 *
 * The composer offered "Ask permissions — Always ask before making changes" as
 * the DEFAULT, and the value never left the browser: the server hard-coded
 * `acceptEdits`, so the user was told they would be asked and was not. This is
 * the enforcement behind every option that menu still offers. It runs inside
 * `canUseTool`, and the provider's PreToolUse hook is what guarantees
 * `canUseTool` is consulted in every mode — without it `acceptEdits` and
 * `bypassPermissions` never call it at all (measured on the real CLI).
 *
 * Pure apart from path canonicalisation, so the provider test and the property
 * test below can drive it directly.
 */

export type ModeVerdict =
  | { kind: 'allow' }
  | { kind: 'deny'; message: string }
  /** Put `question` to the user; `key` identifies the call for "already declined". */
  | { kind: 'ask'; question: ApprovalQuestion; key: string };

export interface ModeContext {
  /** The directory the run is rooted at — the provider's `effectiveCwd`. */
  cwd: string | undefined;
  /**
   * Where the SDK keeps plan files: `<CLAUDE_CONFIG_DIR>/plans`. Plan mode's
   * one permitted write — the SDK tells the model to write its plan there, and
   * that file is how the plan reaches the Code surface's plan sheet.
   */
  plansDir: string;
}

/**
 * Tools that change nothing, by EXACT name.
 *
 * Exact, not `toolMatches`: that helper collapses `mcp__evil__TodoWrite` onto
 * `TodoWrite`, which is the safe direction for a deny set and the unsafe one
 * for an exemption like this.
 */
const NO_CHANGE = new Set([
  // Spawning a subagent changes nothing by itself, and every call the subagent
  // makes comes back through this same gate — measured on the real CLI.
  'Agent',
  'Task',
  'AskUserQuestion',
  'TodoWrite',
  'Skill',
  'ToolSearch',
  'EnterPlanMode',
  'ExitPlanMode',
  // Read a background shell's output; starting that shell was already gated.
  'BashOutput',
  'TaskOutput',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'canvas',
  'mcp__aime__canvas',
  // Readers whose names the verb classifier cannot parse ("Excel" and "web"
  // are not read verbs), so it calls them unknown.
  'mcp__aime__ExcelRead',
  'mcp__web-search__web_search',
  // Asks the user itself, through its own card.
  'mcp__aime__RequestConnector',
  // The preview panel's browser: it acts inside the page the user is watching,
  // never on the project's files.
  ...[...BROWSER_TOOL_NAMES].map((n) => `mcp__aime__${n}`),
]);

/**
 * Could this call change something — a file, the machine, the outside world?
 *
 * Built on `classifyToolCall`, the classifier the unattended approval policy
 * already relies on: `Bash` is judged by its command (a vetted table of
 * read-only binaries; anything it cannot prove read-only is not), file tools
 * are consequential, and a tool whose name it cannot read is `unknown` —
 * which counts as a change here. Failing towards asking is the point.
 */
export function isChange(toolName: string, input: Record<string, unknown>): boolean {
  if (NO_CHANGE.has(toolName)) return false;
  if (borrowsBuiltinName(toolName)) return true;
  const cls = classifyToolCall(toolName, input);
  return cls === 'consequential' || cls === 'unknown';
}

/**
 * Names `classifyToolCall` decides from a fixed table rather than by verb —
 * after stripping any `mcp__<server>__` prefix. That is right for the SDK's own
 * tools and for this app's in-process server, and wrong for anyone else's: a
 * connector that calls a tool `Read` or `TodoWrite` would inherit the built-in's
 * verdict. Such a tool is treated as a change, so the mode asks.
 */
const TABLE_DECIDED = new Set([
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task', 'Skill',
  'AskUserQuestion', 'canvas', 'CronCreate', 'StandingOrderCreate', 'NotebookEdit', 'Write', 'Edit', 'Bash',
]);

function borrowsBuiltinName(toolName: string): boolean {
  if (!toolName.startsWith('mcp__') || toolName.startsWith('mcp__aime__')) return false;
  const base = baseToolName(toolName);
  return TABLE_DECIDED.has(base) || base.startsWith('browser_');
}

/**
 * Does `target` land inside `base`, symlinks resolved?
 *
 * A relative target is resolved against the RUN's working directory, because
 * that is what the tool will do with it — not against `base`. Resolving it
 * against `base` would make `src/app.ts` look like a file in the plans
 * directory and let plan mode write it into the project. With no working
 * directory to resolve against, a relative path is not inside anything.
 */
function inside(base: string | undefined, target: string | null, cwd: string | undefined): boolean {
  if (!base || !target) return false;
  if (!path.isAbsolute(target) && !cwd) return false;
  const resolved = canonicalise(path.resolve(cwd ?? path.sep, target));
  return resolveWithinTree(canonicalise(base), resolved).ok;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

const OPTIONS: ApprovalQuestion['options'] = [
  { label: 'Allow once', description: 'Let it run. You will be asked again next time.' },
  { label: 'Deny', description: 'Do not run it. The agent is told and carries on.' },
];

/** The card for one call. The text doubles as the answer key, so it names the call. */
function question(header: string, text: string): ApprovalQuestion {
  return { header, question: text, options: OPTIONS, multiSelect: false };
}

function describeCall(toolName: string, input: Record<string, unknown>): { what: string; key: string } {
  const name = baseToolName(toolName);
  if (toolMatches(toolName, SHELL_TOOLS) && typeof input.command === 'string') {
    const command = input.command;
    return {
      what: `Run this command?\n\n${clip(command, 500)}`,
      // Normalised like the destructive gate's key, so a respelling of a
      // declined command is the same refusal rather than a fresh card.
      key: `mode:shell:${command.replace(/["']/g, '').replace(/\s+/g, ' ').trim()}`,
    };
  }
  const target = writeTargetOf(input);
  if (target) {
    return { what: `Let ${clip(name, 80)} change ${clip(target, 300)}?`, key: `mode:${name}:${target}` };
  }
  return { what: `Let the assistant run ${clip(name, 80)}?`, key: `mode:${name}` };
}

const PLAN_REFUSAL = (name: string) =>
  `${name} was not run: Plan mode is on, so this turn investigates and plans but makes no ` +
  `changes — no file edits and no commands that could change anything. Keep reading, then ` +
  `write up the plan and stop. The user switches modes in the composer when they want it ` +
  `carried out.`;

const PLAN_EXIT_REFUSAL =
  `The plan has been shown to the user. Plan mode stays on until they change it in the ` +
  `composer — it cannot be approved from here — so do not start on the changes. Finish ` +
  `your reply with the plan and stop. Do not call ExitPlanMode again.`;

export function evaluatePermissionMode(
  mode: CodePermissionMode,
  toolName: string,
  input: Record<string, unknown>,
  ctx: ModeContext,
): ModeVerdict {
  switch (mode) {
    case 'bypass':
      // Nothing extra. The Settings security toggles and the connector policy
      // still apply — they are separate gates in the same `canUseTool`.
      return { kind: 'allow' };

    case 'plan': {
      if (toolName === 'ExitPlanMode') return { kind: 'deny', message: PLAN_EXIT_REFUSAL };
      if (isFileWriteTool(toolName)) {
        // The plan file is the one write plan mode exists to make.
        return inside(ctx.plansDir, writeTargetOf(input), ctx.cwd)
          ? { kind: 'allow' }
          : { kind: 'deny', message: PLAN_REFUSAL(baseToolName(toolName)) };
      }
      return isChange(toolName, input)
        ? { kind: 'deny', message: PLAN_REFUSAL(baseToolName(toolName)) }
        : { kind: 'allow' };
    }

    case 'default': {
      if (!isChange(toolName, input)) return { kind: 'allow' };
      const { what, key } = describeCall(toolName, input);
      return { kind: 'ask', question: question('Approval — Ask permissions', what), key };
    }

    case 'acceptEdits': {
      // Edits inside the project folder are the ones this mode accepts. Anything
      // that names a path outside it — or names none we can read — is asked about.
      if (isFileWriteTool(toolName)) {
        const target = writeTargetOf(input);
        if (inside(ctx.cwd, target, ctx.cwd)) return { kind: 'allow' };
        const { what, key } = describeCall(toolName, input);
        return {
          kind: 'ask',
          question: question('Approval — outside the project folder', `${what}\n\nThat is outside the project folder.`),
          key,
        };
      }
      // A speed bump rather than a boundary — see shell-write-scope — which is
      // why the menu's description only promises this for edits.
      if (toolMatches(toolName, SHELL_TOOLS) && typeof input.command === 'string') {
        const outside = shellWriteOutside(input.command, ctx.cwd);
        if (outside.target) {
          const { what, key } = describeCall(toolName, input);
          return {
            kind: 'ask',
            question: question(
              'Approval — outside the project folder',
              `${what}\n\nIt writes to ${clip(outside.target, 300)}, outside the project folder.`,
            ),
            key,
          };
        }
      }
      return { kind: 'allow' };
    }
  }
}
