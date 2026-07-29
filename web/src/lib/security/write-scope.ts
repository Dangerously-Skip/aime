/**
 * Where the file tools may write when "Restrict writes to project folder" is on.
 *
 * This setting used to be a sentence in the system prompt asking the model
 * nicely. Unlike a shell command — which cannot be classified reliably, see
 * ./destructive-commands — a write target is decidable, so this one is enforced.
 *
 * ## What it does not cover, deliberately
 *
 * The file TOOLS, not "writes". `Bash` with `echo x > /etc/y` resolves nothing
 * here and is unaffected; that is the destructive-command gate's job. The
 * setting's description says as much, because a control that oversells its reach
 * is the exact bug this branch has been unpicking.
 *
 * ## The carve-out, and why it is only scratch
 *
 * A naive "must be under cwd" check breaks the app on its first turn: scratch
 * directories live at `~/.aime/scratch/<chatId>`, outside any project folder, and
 * the agent writes intermediates there by design.
 *
 * The first version allowed the WHOLE of `~/.aime`, which was a privilege
 * escalation rather than a convenience. That directory also holds
 * `credentials.enc` (every provider and connector secret) and is handed to the
 * SDK as `CLAUDE_CONFIG_DIR` — so a permitted write to `~/.aime/settings.json`
 * could install a `PreToolUse` hook command, which the SDK then executes
 * *without ever entering `canUseTool`*. A restriction that can be used to escape
 * itself is worse than no restriction, because it is trusted. Only the scratch
 * subtree is allowed now.
 *
 * Temp stays allowed: a script staging a file in `os.tmpdir()` is ordinary work,
 * and a user restricting writes to their project means "don't touch my other
 * projects and my home directory", not "never use a temp file".
 *
 * ## Symlinks are resolved, not trusted
 *
 * Containment used to be pure string resolution, so `ln -s /Users/x/.ssh
 * ./s` followed by a write to `./s/authorized_keys` landed in `~/.ssh` — and the
 * agent could create that link itself, since `ln` matches no destructive rule.
 * Both sides are canonicalised through `fs.realpathSync` before comparison. For
 * a target that does not exist yet (the normal case for a write) the deepest
 * EXISTING ancestor is resolved and the remainder appended, which is what
 * catches a link in the middle of the path.
 *
 * This is also why `os.tmpdir()` is realpath'd rather than used raw: on macOS it
 * returns `/var/folders/...` while every resolved form is `/private/var/...`,
 * two strings that share no prefix. The carve-out silently did not work, and a
 * tool handing back a resolved temp path was refused.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDataDir } from '../app-paths';
import { resolveWithinTree } from '../path-containment';
import { toolMatches } from './tool-names';

/**
 * Tools that take a path and write to it — including the in-process MCP writers,
 * which arrive as `mcp__aime__<Name>`. `toolMatches` handles the prefix; leaving
 * them out meant the gate never ran for `ExcelWrite`, `DocumentCreate` or
 * `SkillCreate`, all of which take a model-supplied absolute path.
 */
export const FILE_WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'ExcelWrite',
  'ExcelEdit',
  'DocumentCreate',
  'SkillCreate',
  'VoiceProfileSave',
]);

/** Does this tool write to a path the model chose? */
export function isFileWriteTool(name: string): boolean {
  return toolMatches(name, FILE_WRITE_TOOLS);
}

/**
 * Every input key a file tool might carry its destination under. Checked as a
 * set rather than a single field because the SDK's tools disagree, and a key we
 * do not read is a silent fail-open.
 */
const PATH_KEYS = ['file_path', 'notebook_path', 'path', 'filePath', 'outputPath', 'target'];

/** The write destination in a tool's input, or null if it carries none. */
export function writeTargetOf(input: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/**
 * Canonical form of a path that may not exist yet: realpath the deepest existing
 * ancestor, then re-append the part that does not exist. Resolving symlinks in
 * the ancestors is the whole point — that is where the escape lives.
 */
export function canonicalise(p: string): string {
  let current = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch {
      const parent = path.dirname(current);
      // Reached the root without finding anything real — nothing to resolve.
      if (parent === current) return path.resolve(p);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Base directories are stable for the process, and `getDataDir()` performs a
 * filesystem migration probe on every call — so resolving them per tool call put
 * blocking syscalls on the `canUseTool` hot path, hundreds of times a turn.
 */
let cachedBases: { dataScratch: string; tmp: string } | null = null;
function stableBases() {
  cachedBases ??= {
    dataScratch: canonicalise(path.join(getDataDir(), 'scratch')),
    tmp: canonicalise(os.tmpdir()),
  };
  return cachedBases;
}

/** Test seam — the cache would otherwise outlive a test's stubbed dirs. */
export function resetWriteScopeCache(): void {
  cachedBases = null;
}

/**
 * May this path be written, given the working directory?
 *
 * Fails CLOSED: anything unresolvable is refused rather than allowed.
 */
export function writeTargetAllowed(
  target: string,
  cwd: string,
  deps: { dataScratch?: string; tmpDir?: string } = {},
): boolean {
  if (!target || !cwd) return false;
  const stable = deps.dataScratch !== undefined && deps.tmpDir !== undefined
    ? { dataScratch: deps.dataScratch, tmp: deps.tmpDir }
    : stableBases();

  // Resolve against the RUN's cwd before canonicalising: a tool passing
  // `src/lib/x.ts` means the working directory, not the server process's own
  // directory, which is what `path.resolve` would otherwise use.
  const resolved = canonicalise(path.resolve(cwd, target));
  const bases = [canonicalise(cwd), stable.dataScratch, stable.tmp];
  return bases.some((base) => resolveWithinTree(base, resolved).ok);
}
