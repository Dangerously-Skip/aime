/**
 * Shared artifact tracking utilities.
 * Categorizes tool calls into "context" (files read) and "artifact" (files created/edited).
 *
 * Genuinely shared now. Cowork used to keep its own copy inside
 * `cowork-surface.tsx` — a superset that also showed spawned agents, search
 * queries and bare commands — while this header claimed both surfaces used
 * this one. Two implementations of a rule is how they drift, and the drift here
 * was already load-bearing: only Cowork's copy reset `BASH_ARTIFACT_EXT`'s
 * lastIndex, and only this one was reachable from tests.
 *
 * The difference between them was never the CATEGORISING, it was which entries
 * a sidebar wants to show. That is now `CategorizeOptions.richContext` — one
 * flag, at the call site, instead of a second function.
 */
import { AGENT_PREFIX, SEARCH_PREFIX, COMMAND_PREFIX } from './cowork/context-entry';

// Bash patterns that indicate file creation/modification (capture group 1 = output path)
export const BASH_WRITE_PATTERNS = [
  /(?<![0-9&])>\s*(?!&|\s*$)(\S+)/,    // echo "x" > file, cat > file (skip 2>&1, >&2)
  /tee\s+(?:-a\s+)?(\S+)/,             // tee file, tee -a file
  /cp\s+\S+\s+(\S+)/,                  // cp src dest
  /mv\s+\S+\s+(\S+)/,                  // mv src dest
  /mkdir\s+(?:-p\s+)?(\S+)/,           // mkdir -p dir
  /touch\s+(\S+)/,                      // touch file
];

// Bash commands that are noisy / not worth tracking in sidebar
export const BASH_NOISE = /^\s*(ls|cd|pwd|echo(?!\s.*>)|git\s+(status|log|diff|branch|show)|cat\s|head\s|tail\s|wc\s|which\s|type\s|env|printenv|date|whoami|uname|curl\s|wget\s)/;

// Binary/document extensions that Bash scripts produce (not tracked by Write/Edit tools).
// Character class includes `~` so paths like `~/foo.pptx` are captured intact —
// without it the leading tilde gets stripped, leaving `/foo.pptx`, which doesn't exist.
export const BASH_ARTIFACT_EXT = /(?:^|[\s'"=])(~?[\w./-]+\.(?:pptx?|docx?|xlsx?|pdf|csv|png|jpe?g|gif|svg|webp|mp[34]|wav|ogg|zip|tar\.gz|tgz))\b/gi;

// Filter out HTML tag fragments, internal paths, and garbage from artifact/context names
export function isValidSidebarEntry(path: string): boolean {
  if (!path || path.length < 2) return false;
  if (/^[a-z]+>/.test(path) || path.includes('<') || path.includes('>')) return false;
  if (/^[^a-zA-Z0-9/~.]+$/.test(path) || /^[|&;]+/.test(path)) return false;
  if (path.includes('?') || path.includes('://') || path.startsWith('http')) return false;
  if (!path.includes('/') && /^[\w.-]+\.(?:css|js|jsx|ts|tsx|html?|woff2?|ttf|eot|ico|map)$/i.test(path)) return false;
  // Filter internal app operations (document extraction temp files), but allow user
  // artifacts in scratch space. Checks the legacy .quarry dir too — old conversations
  // still reference pre-rename paths.
  if (path.includes('.aime/') && !path.includes('.aime/scratch/')) return false;
  if (path.includes('.quarry/') && !path.includes('.quarry/scratch/')) return false;
  if (path.includes('/scratch/') && path.includes('/documents/')) return false;
  return true;
}

export interface CategorizedToolCall {
  category: "context" | "artifact";
  path: string;
}

/** The shape this needs off a message; deliberately narrower than the store's. */
interface ToolCallLike {
  name: string;
  input?: Record<string, unknown>;
}
interface MessageLike {
  toolCalls?: ToolCallLike[];
}

/**
 * Every artifact a conversation has produced, read back from its own transcript.
 *
 * Chat used to ACCUMULATE this in component state as the stream ran, with a
 * comment on the reset saying artifacts "can't be derived". They can — the tool
 * calls are on the messages and the messages are persisted — and the cost of
 * believing otherwise was that the panel showed 0 for a conversation whose deck
 * was sitting in the transcript two inches away. Switching conversations and
 * back, or reloading the app, emptied it; only the turn you were watching live
 * ever had contents.
 *
 * Deriving also removes the two `setArtifactFiles([])` resets and their
 * `react-hooks/set-state-in-effect` suppressions: a value computed from the
 * conversation cannot be stale for the conversation.
 *
 * Two passes, because they catch different things:
 *   1. `categorizeToolCall` — the tool NAMED a path (Write, Edit, `cat > f`)
 *   2. `BASH_ARTIFACT_EXT` — a command MENTIONED a document filename, which is
 *      how a script that writes its own output (`… script.sh in.md out.pptx`)
 *      gets noticed at all
 *
 * Insertion order is preserved so the panel reads chronologically.
 */
export function artifactsFromMessages(messages: readonly MessageLike[]): string[] {
  const found = new Set<string>();

  /*
   * One rule, applied to both passes.
   *
   * It used to sit only in the sweep, so `sh mk.sh .cache.pdf` was filtered
   * there and then let straight back in by `categorizeToolCall`, which runs its
   * own extension match with no dotfile guard. A hidden working file in the
   * artifacts panel is small, but two passes disagreeing about what an artifact
   * IS is the shape that put a second copy of this whole function in
   * cowork-surface.tsx. Found by mutation testing, not by reading.
   */
  const keep = (path: string): boolean =>
    path.length >= 3 && !path.startsWith('.') && path !== '/dev/null' && isValidSidebarEntry(path);

  for (const msg of messages) {
    for (const tc of msg.toolCalls ?? []) {
      const input = tc.input ?? {};

      // The sweep below reads left to right; `categorizeToolCall` reports only
      // the RIGHTMOST document in a command. Sweeping first is what keeps the
      // panel chronological when one call produces several files.
      if (tc.name === "Bash" && typeof input.command === "string") {
        // The loop below always runs to exhaustion, which resets lastIndex on its
        // own — this is belt and braces against a future early `break`, not a bug
        // being held at bay. Said plainly because the identical line elsewhere in
        // this codebase IS load-bearing.
        BASH_ARTIFACT_EXT.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = BASH_ARTIFACT_EXT.exec(input.command)) !== null) {
          if (keep(match[1])) found.add(match[1]);
        }
      }

      const categorized = categorizeToolCall(tc.name, input);
      if (categorized?.category === "artifact" && keep(categorized.path)) {
        found.add(categorized.path);
      }
    }
  }

  return [...found];
}

export interface CategorizeOptions {
  /**
   * Show the things that are activity rather than files: a spawned agent, a
   * search query, a bare command. Cowork's sidebar is a picture of what the
   * agent is DOING and wants them; Chat's lists files and would only be
   * cluttered. This is the whole difference between the two surfaces, and it
   * used to be expressed as two copies of the function.
   */
  richContext?: boolean;
}

export function categorizeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  opts: CategorizeOptions = {},
): CategorizedToolCall | null {
  // A spawned subagent is activity, not a file — shown only where activity is.
  if (toolName === "spawn_agent") {
    if (!opts.richContext) return null;
    const agentName = typeof toolInput.agentName === "string" ? toolInput.agentName : null;
    const task = typeof toolInput.task === "string" ? toolInput.task : "";
    const label = `${task.slice(0, 40)}${task.length > 40 ? "…" : ""}`;
    return { category: "context", path: `${AGENT_PREFIX}${agentName ?? "subagent"}: ${label}` };
  }

  // Search queries, likewise.
  if (toolName.includes("web_search") || toolName.includes("searxng") || toolName === "WebSearch") {
    if (!opts.richContext) return null;
    const raw = toolInput.query || toolInput.q;
    return typeof raw === "string" ? { category: "context", path: `${SEARCH_PREFIX}${raw}` } : null;
  }

  // Explicit artifact tools
  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit" ||
      toolName === "ExcelWrite" || toolName === "ExcelEdit" ||
      toolName.endsWith("__ExcelWrite") || toolName.endsWith("__ExcelEdit") ||
      toolName.endsWith(":ExcelWrite") || toolName.endsWith(":ExcelEdit")) {
    const raw = toolInput.file_path || toolInput.path || toolInput.notebook_path;
    return typeof raw === "string" ? { category: "artifact", path: raw } : null;
  }

  // WebFetch — never add to sidebar
  if (toolName === "WebFetch") return null;

  // Explicit context tools
  if (toolName === "Read" || toolName === "Glob" || toolName === "Grep" ||
      toolName === "ExcelRead" || toolName.endsWith("__ExcelRead") || toolName.endsWith(":ExcelRead")) {
    const raw = toolInput.file_path || toolInput.path || toolInput.pattern || toolInput.url || toolInput.query;
    if (typeof raw !== "string") return null;
    if (raw.includes('.claude/') || raw.includes('CLAUDE.md') || raw.includes('/plugins/') ||
        raw.includes('.aime/') || raw.includes('.quarry/') || raw.includes('/scratch/') ||
        raw.endsWith('.sh') || raw.endsWith('.py') || raw.includes('node_modules/')) return null;
    if (toolName === "Glob" || toolName === "Grep") return null;
    return { category: "context", path: raw };
  }

  // Bash — inspect command to decide
  if (toolName === "Bash") {
    const cmd = typeof toolInput.command === "string" ? toolInput.command : "";
    if (!cmd) return null;

    for (const pat of BASH_WRITE_PATTERNS) {
      const m = cmd.match(pat);
      if (m?.[1]) {
        const p = m[1].replace(/['"]/g, "");
        if (p === "/dev/null" || p.startsWith("&") || /^[0-9]+$/.test(p)) continue;
        return { category: "artifact", path: p };
      }
    }

    // Script invocations whose output is a binary/document type (e.g.
    // `bash generate_presentation.sh in.md out.pptx` produces the .pptx).
    // Pick the rightmost matching token — by convention scripts take
    // outputs as the last positional arg.
    const extMatches = [...cmd.matchAll(BASH_ARTIFACT_EXT)];
    if (extMatches.length > 0) {
      const last = extMatches[extMatches.length - 1][1].replace(/['"]/g, "");
      return { category: "artifact", path: last };
    }

    if (BASH_NOISE.test(cmd)) return null;

    // A command that wrote nothing recognisable is still activity worth showing
    // where activity is shown, and clutter where it is not.
    if (!opts.richContext) return null;
    const short = cmd.length > 60 ? cmd.substring(0, 57) + "..." : cmd;
    return { category: "context", path: `${COMMAND_PREFIX}${short}` };
  }

  return null;
}
