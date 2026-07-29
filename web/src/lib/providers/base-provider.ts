/**
 * Chunk types emitted by all providers during streaming.
 */
export type ChunkType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'turn_start'
  | 'session_init'
  | 'system_init'
  | 'done'
  | 'aborted'
  | 'error'
  | 'connected'
  | 'status'
  | 'assistant'
  | 'input_request'
  | 'canvas'
  | 'heartbeat_result'
  | 'document_extracting'
  | 'document_extracted'
  | 'prompt_suggestion'
  | 'cron_create'
  | 'standing_order_create'
  | 'widget_create'
  | 'connector_request'
  | 'document_print';

/**
 * A single streaming chunk yielded by a provider's query() method.
 */
export interface StreamChunk {
  type: ChunkType;
  provider: string;
  content?: string;
  message?: string;
  session_id?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  result?: unknown;
  tool_use_id?: string;
  isReasoning?: boolean;
  [key: string]: unknown;
}

/**
 * Parameters accepted by provider.query().
 */
export interface QueryParams {
  prompt: string;
  chatId: string;
  surfaceId?: string;
  userId?: string;
  mcpServers?: Record<string, unknown>;
  /**
   * Tools that are auto-approved — NOT the set of tools that exist.
   *
   * That is the SDK's own meaning ("auto-allowed without prompting for
   * permission… To restrict which tools are available, use the `tools` option
   * instead"), and it is why removing a name from here restricts nothing: the
   * tool stays mounted, `permissionMode` is `bypassPermissions`, and
   * `canUseTool` falls through to allow. Every surface config also omits tools
   * that demonstrably work — `WidgetCreate` is on no surface's list — so the
   * complement of this array is not a deny list and must never be used as one.
   *
   * To actually withhold a tool, put it in `deniedTools`.
   */
  allowedTools?: string[];
  /**
   * Tools this run must not be able to use, whatever else says otherwise.
   *
   * Enforced twice on purpose: handed to the SDK as `disallowedTools`, which
   * removes them from the model's context so it never reaches for them, and
   * refused in `canUseTool`, which runs regardless of `permissionMode` so
   * enforcement does not rest on the SDK honouring an option.
   */
  deniedTools?: string[];
  /**
   * The user's security toggles.
   *
   * Absent ⇒ the provider LOADS them from `lib/security/settings`, which is the
   * point: they used to be absent on seven of nine call sites, so a control the
   * UI called "enforced" did nothing there. Pass an explicit set only to override
   * the user's stored preference (tests do).
   */
  securitySettings?: Partial<import('../security/settings').SecuritySettings>;
  maxTurns?: number;
  systemPrompt?: string | { type: string; preset: string; append?: string };
  model?: string;
  attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' | 'spreadsheet' | 'presentation' | 'audio' | 'video'; filePath?: string; extractedPath?: string }>;
  webSearch?: boolean;
  projectInstructions?: string;
  projectKnowledge?: string;
  apiKey?: string;
  /**
   * Anthropic-compatible base URL for a user-added provider (OpenRouter's
   * anthropic endpoint, a self-hosted gateway, or the local openai-compat
   * shim). When set, drives the agent loop against that endpoint instead of
   * the default Anthropic API. Ignored by non-Claude providers.
   */
  baseUrl?: string;
  cwd?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Session controls from slash commands (thinking, effort, model override). */
  sessionControls?: import('../slash-commands').SessionControls;
  /** Callback to send an input_request event to the client during streaming. */
  onInputRequest?: (toolUseId: string, questions: unknown) => Promise<void>;
  /**
   * Callback to send a connector_request event to the client during streaming.
   * Lets the agent pause mid-task and ask for a service it needs (P3.3).
   */
  onConnectorRequest?: (toolUseId: string, connectorId: string, reason: string) => Promise<void>;
  /**
   * Ask the client to print a rendered document to PDF (P4.2b). Needed because
   * the server is a child process of Electron and cannot call ipcMain itself.
   *
   * A PATH, not the markup. The tool has already written the HTML to disk by the
   * time it asks, so shipping the string as well copied it through the SSE frame,
   * the renderer, the IPC message and a data URL — four copies of a document that
   * was sitting on the filesystem the whole time.
   */
  onDocumentPrint?: (
    toolUseId: string,
    payload: { htmlPath: string; outputPath: string; printOptions: Record<string, unknown> },
  ) => Promise<void>;
  /** Callback to send a browser_tool_use event to the client during streaming. */
  onBrowserToolUse?: (toolUseId: string, toolName: string, input: Record<string, unknown>) => Promise<void>;
  /**
   * Approval policy for this run (P6/C3). Unset ⇒ the provider infers:
   * unattended runs gate consequential actions, interactive sessions don't.
   */
  approvalPolicy?: import('../runs/types').ApprovalPolicy;
}

/**
 * Configuration passed to a provider constructor.
 */
export interface ProviderConfig {
  allowedTools?: string[];
  maxTurns?: number;
  permissionMode?: string;
  model?: string;
  hostname?: string;
  port?: number;
  useExistingServer?: boolean;
  existingServerUrl?: string | null;
  [key: string]: unknown;
}

/**
 * Base provider interface for AI agent providers.
 * All providers must implement these methods.
 */
export abstract class BaseProvider {
  config: ProviderConfig;
  sessions: Map<string, string>;
  sessionCwds: Map<string, string>;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
    this.sessions = new Map();
    this.sessionCwds = new Map();
  }

  /**
   * Get the provider name.
   */
  abstract get name(): string;

  /**
   * Initialize the provider.
   */
  async initialize(): Promise<void> {
    // Override in subclass if needed
  }

  /**
   * Execute a query/prompt and yield streaming responses.
   */
  abstract query(params: QueryParams): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Get session ID for a chat.
   */
  getSession(chatId: string): string | null {
    return this.sessions.get(chatId) || null;
  }

  /**
   * Store a session ID for a chat, optionally with its working directory.
   */
  setSession(chatId: string, sessionId: string, cwd?: string): void {
    this.sessions.set(chatId, sessionId);
    if (cwd) this.sessionCwds.set(chatId, cwd);
  }

  /**
   * Get the cwd associated with a session.
   */
  getSessionCwd(chatId: string): string | null {
    return this.sessionCwds.get(chatId) || null;
  }

  /**
   * Build a composite key for abort controller tracking.
   * When surfaceId is provided, multiple surfaces can run concurrent queries
   * for the same chatId without colliding.
   */
  getAbortKey(chatId: string, surfaceId?: string): string {
    return surfaceId ? `${surfaceId}:${chatId}` : chatId;
  }

  /**
   * Abort an active query for a given chatId.
   */
  abort(_chatId: string, _surfaceId?: string): boolean {
    // Override in subclass to implement abort functionality
    return false;
  }

  /**
   * Clear session for a chatId (used by session reset policies).
   */
  clearSession(chatId: string): void {
    this.sessions.delete(chatId);
    this.sessionCwds.delete(chatId);
    console.log('[Provider] Session cleared for chatId:', chatId);
  }

  /**
   * Cleanup resources.
   */
  async cleanup(): Promise<void> {
    this.sessions.clear();
    this.sessionCwds.clear();
  }
}
