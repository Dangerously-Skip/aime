/**
 * Tracks file modifications made by the agent.
 *
 * Watches for Write and Edit tool calls in PostToolUse and records the
 * file path, action type, and metadata.  This gives callers a live view
 * of every file the agent has touched during a session.
 *
 * @param {Object} options
 * @param {string} [options.surfaceId] - Surface identifier
 * @param {string} [options.chatId]    - Chat session identifier
 * @returns {{ hookConfig: Object, getModifications: Function, getModifiedFiles: Function, clear: Function }}
 */
export function createFileWatcher(options = {}) {
  // Tool names that perform file modifications
  const WRITE_TOOLS = new Set(['Write']);
  const EDIT_TOOLS  = new Set(['Edit']);
  const BASH_TOOL   = 'Bash';

  /**
   * Map of file path -> modification record.
   * If the same file is modified multiple times, the record is updated
   * with the latest timestamp and an incremented count.
   *
   * @type {Map<string, { path: string, action: string, timestamp: number, surfaceId: string, chatId: string, count: number }>}
   */
  const modifications = new Map();

  /**
   * Extract the file path from the tool input payload.
   * Agent SDK tool inputs vary by tool; this handles the common shapes.
   */
  function extractFilePath(toolName, input) {
    // Write and Edit tools pass file_path directly
    if (input.file_path) return input.file_path;
    // Fallback: some tools use 'path'
    if (input.path) return input.path;
    return null;
  }

  /**
   * Determine the action label for a given tool.
   */
  function actionFor(toolName) {
    if (WRITE_TOOLS.has(toolName)) return 'write';
    if (EDIT_TOOLS.has(toolName))  return 'edit';
    return 'modify';
  }

  const hook = async (input) => {
    const toolName = input.tool_name;

    // Only track file-modifying tools
    if (!WRITE_TOOLS.has(toolName) && !EDIT_TOOLS.has(toolName)) {
      return {};
    }

    const filePath = extractFilePath(toolName, input.tool_input || input.input || input);
    if (!filePath) return {};

    const existing = modifications.get(filePath);
    if (existing) {
      existing.timestamp = Date.now();
      existing.action    = actionFor(toolName);
      existing.count    += 1;
    } else {
      modifications.set(filePath, {
        path:      filePath,
        action:    actionFor(toolName),
        timestamp: Date.now(),
        surfaceId: options.surfaceId || 'unknown',
        chatId:    options.chatId    || 'unknown',
        count:     1,
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
     * @returns {Array<Object>}
     */
    getModifications() {
      return [...modifications.values()];
    },

    /**
     * Get just the file paths that have been modified.
     * @returns {string[]}
     */
    getModifiedFiles() {
      return [...modifications.keys()];
    },

    /**
     * Clear all tracked modifications.
     */
    clear() {
      modifications.clear();
    },
  };
}
