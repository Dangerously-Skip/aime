/**
 * Tool log entry recorded by the monitor.
 */
export interface ToolLogEntry {
  tool: string;
  timestamp: number;
  duration: number | null;
  surfaceId: string;
  chatId: string;
}

/**
 * Input shape passed to PostToolUse hooks by the Agent SDK.
 */
export interface PostToolUseInput {
  tool_name: string;
  duration_ms?: number;
  error?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  tool_input?: Record<string, unknown>;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Hook matcher entry for the Agent SDK hook config.
 */
export interface HookMatcher {
  matcher: string;
  hooks: Array<(input: PostToolUseInput) => Promise<Record<string, unknown>>>;
}

/**
 * Agent SDK hook config shape.
 */
export interface HookConfig {
  PostToolUse?: HookMatcher[];
  [key: string]: HookMatcher[] | undefined;
}

export interface ToolMonitorOptions {
  surfaceId?: string;
  chatId?: string;
  onToolUse?: (entry: ToolLogEntry) => void;
}

export interface ToolMonitorResult {
  hookConfig: HookConfig;
  getLog: () => ToolLogEntry[];
  clear: () => void;
}

/**
 * PostToolUse hook that logs all tool calls.
 *
 * Records every tool invocation with name, timestamp, duration, and
 * surface/chat context. An optional `onToolUse` callback lets callers
 * react to each entry in real time (e.g. emit SSE events).
 */
export function createToolMonitor(options: ToolMonitorOptions = {}): ToolMonitorResult {
  const toolLog: ToolLogEntry[] = [];

  const hook = async (input: PostToolUseInput): Promise<Record<string, unknown>> => {
    const entry: ToolLogEntry = {
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[ToolMonitor] onToolUse callback error:', message);
      }
    }

    return {};
  };

  return {
    hookConfig: {
      PostToolUse: [{ matcher: '.*', hooks: [hook] }],
    },
    /** Return a shallow copy of the accumulated log entries. */
    getLog: () => [...toolLog],
    /** Clear all accumulated log entries. */
    clear: () => {
      toolLog.length = 0;
    },
  };
}
