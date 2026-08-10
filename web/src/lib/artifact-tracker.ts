/**
 * Shared artifact tracking utilities.
 * Categorizes tool calls into "context" (files read) and "artifact" (files created/edited).
 *
 * Chat calls `categorizeToolCall` from here. Cowork does NOT — it has its own
 * copy in `cowork-surface.tsx`, a superset handling `spawn_agent` and search
 * queries, which imports the pattern constants below but duplicates the branch
 * logic. Saying so because this header used to claim both surfaces shared it,
 * and a comment asserting a consolidation that is not there is worse than no
 * comment: it stops the next person from looking.
 */

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
          const path = match[1];
          if (path.length < 3 || path.startsWith(".") || path === "/dev/null") continue;
          if (!isValidSidebarEntry(path)) continue;
          found.add(path);
        }
      }

      const categorized = categorizeToolCall(tc.name, input);
      if (categorized?.category === "artifact" && isValidSidebarEntry(categorized.path)) {
        found.add(categorized.path);
      }
    }
  }

  return [...found];
}

export function categorizeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): CategorizedToolCall | null {
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

    return null; // Chat doesn't need bash context entries cluttering the sidebar
  }

  return null;
}
