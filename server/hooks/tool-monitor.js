/**
 * PostToolUse hook that logs all tool calls.
 *
 * Records every tool invocation with name, timestamp, duration, and
 * surface/chat context.  An optional `onToolUse` callback lets callers
 * react to each entry in real time (e.g. emit SSE events).
 *
 * @param {Object} options
 * @param {string} [options.surfaceId] - Surface identifier (chat, cowork, code, etc.)
 * @param {string} [options.chatId]    - Chat session identifier
 * @param {Function} [options.onToolUse] - Callback invoked with each log entry
 * @returns {{ hookConfig: Object, getLog: Function, clear: Function }}
 */
export function createToolMonitor(options = {}) {
  const toolLog = [];

  const hook = async (input) => {
    const entry = {
      tool: input.tool_name,
      timestamp: Date.now(),
      duration: input.duration_ms || null,
      surfaceId: options.surfaceId || 'unknown',
      chatId: options.chatId || 'unknown',
    };

    toolLog.push(entry);

    if (options.onToolUse) {
      try {
        options.onToolUse(entry);
      } catch (err) {
        console.error('[ToolMonitor] onToolUse callback error:', err.message);
      }
    }

    return {};
  };

  return {
    hookConfig: {
      PostToolUse: [{ matcher: '.*', hooks: [hook] }],
    },
    /** Return a shallow copy of the accumulated log entries */
    getLog: () => [...toolLog],
    /** Clear all accumulated log entries */
    clear: () => {
      toolLog.length = 0;
    },
  };
}
