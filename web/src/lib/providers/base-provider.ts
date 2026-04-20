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
  | 'document_extracted';

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
  allowedTools?: string[];
  maxTurns?: number;
  systemPrompt?: string | { type: string; preset: string; append?: string };
  model?: string;
  attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' | 'spreadsheet' | 'presentation' | 'audio' | 'video'; filePath?: string; extractedPath?: string }>;
  webSearch?: boolean;
  projectInstructions?: string;
  projectKnowledge?: string;
  apiKey?: string;
  cwd?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Session controls from slash commands (thinking, effort, model override). */
  sessionControls?: import('../slash-commands').SessionControls;
  /** Callback to send an input_request event to the client during streaming. */
  onInputRequest?: (toolUseId: string, questions: unknown) => Promise<void>;
  /** Callback to send a browser_tool_use event to the client during streaming. */
  onBrowserToolUse?: (toolUseId: string, toolName: string, input: Record<string, unknown>) => Promise<void>;
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
  abort(chatId: string, surfaceId?: string): boolean {
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
