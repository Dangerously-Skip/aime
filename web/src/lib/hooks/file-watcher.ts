import type { PostToolUseInput, HookConfig } from './tool-monitor';

/**
 * Record of a file modification made by the agent.
 */
export interface FileModification {
  path: string;
  action: 'write' | 'edit' | 'modify';
  timestamp: number;
  surfaceId: string;
  chatId: string;
  count: number;
}

export interface FileWatcherOptions {
  surfaceId?: string;
  chatId?: string;
}

export interface FileWatcherResult {
  hookConfig: HookConfig;
  getModifications: () => FileModification[];
  getModifiedFiles: () => string[];
  clear: () => void;
}

// Tool names that perform file modifications
const WRITE_TOOLS = new Set(['Write']);
const EDIT_TOOLS = new Set(['Edit']);

/**
 * Extract the file path from the tool input payload.
 * Agent SDK tool inputs vary by tool; this handles the common shapes.
 */
function extractFilePath(toolName: string, input: Record<string, unknown>): string | null {
  // Write and Edit tools pass file_path directly
  if (input.file_path) return input.file_path as string;
  // Fallback: some tools use 'path'
  if (input.path) return input.path as string;
  return null;
}

/**
 * Determine the action label for a given tool.
 */
function actionFor(toolName: string): 'write' | 'edit' | 'modify' {
  if (WRITE_TOOLS.has(toolName)) return 'write';
  if (EDIT_TOOLS.has(toolName)) return 'edit';
  return 'modify';
}

/**
 * Tracks file modifications made by the agent.
 *
 * Watches for Write and Edit tool calls in PostToolUse and records the
 * file path, action type, and metadata. This gives callers a live view
 * of every file the agent has touched during a session.
 */
export function createFileWatcher(options: FileWatcherOptions = {}): FileWatcherResult {
  const modifications = new Map<string, FileModification>();

  const hook = async (input: PostToolUseInput): Promise<Record<string, unknown>> => {
    const toolName = input.tool_name;

    // Only track file-modifying tools
    if (!WRITE_TOOLS.has(toolName) && !EDIT_TOOLS.has(toolName)) {
      return {};
    }

    const toolInput = (input.tool_input || input.input || input) as Record<string, unknown>;
    const filePath = extractFilePath(toolName, toolInput);
    if (!filePath) return {};

    const existing = modifications.get(filePath);
    if (existing) {
      existing.timestamp = Date.now();
      existing.action = actionFor(toolName);
      existing.count += 1;
    } else {
      modifications.set(filePath, {
        path: filePath,
        action: actionFor(toolName),
        timestamp: Date.now(),
        surfaceId: options.surfaceId || 'unknown',
        chatId: options.chatId || 'unknown',
        count: 1,
      });
    }

    return {};
  };

  return {
    hookConfig: {
      PostToolUse: [{ matcher: '^(Write|Edit)$', hooks: [hook] }],
    },

    /**
     * Get all modification records as an array.
     */
    getModifications(): FileModification[] {
      return [...modifications.values()];
    },

    /**
     * Get just the file paths that have been modified.
     */
    getModifiedFiles(): string[] {
      return [...modifications.keys()];
    },

    /**
     * Clear all tracked modifications.
     */
    clear(): void {
      modifications.clear();
    },
  };
}
