import { query } from '@anthropic-ai/claude-agent-sdk';
import { BaseProvider } from './base-provider.js';
import { getSurfaceConfig } from '../surfaces/index.js';
import { getBedrockEnv, isBedrockConfigured } from '../bedrock-env.js';

/**
 * Claude Agent SDK provider implementation
 * Matches the exact behavior from server.js
 */
export class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    // Default allowed tools - matches server.js
    this.defaultAllowedTools = config.allowedTools || [
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'WebSearch', 'WebFetch', 'TodoWrite', 'Skill'
    ];
    this.defaultMaxTurns = config.maxTurns || 20;
    this.permissionMode = config.permissionMode || 'bypassPermissions';
    // Track active abort controllers per chatId
    this.abortControllers = new Map();
  }

  get name() {
    return 'claude';
  }

  /**
   * Abort an active query for a given chatId (and optional surfaceId)
   * @param {string} chatId
   * @param {string} [surfaceId]
   */
  abort(chatId, surfaceId) {
    const key = this.getAbortKey(chatId, surfaceId);
    const controller = this.abortControllers.get(key);
    if (controller) {
      console.log('[Claude] Aborting query for key:', key);
      controller.abort();
      this.abortControllers.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Execute a query using Claude Agent SDK
   * Supports optional surface-routed configuration via surfaceId.
   *
   * @param {Object} params
   * @param {string} params.prompt - The user message
   * @param {string} params.chatId - Chat session identifier
   * @param {string} [params.surfaceId] - Surface identifier for config routing (e.g. 'chat', 'cowork', 'code')
   * @param {Object} [params.mcpServers] - MCP server configurations (including Composio)
   * @param {string[]} [params.allowedTools] - List of allowed tool names
   * @param {number} [params.maxTurns] - Maximum conversation turns
   * @param {string} [params.systemPrompt] - System prompt override
   * @param {string} [params.model] - Model name override
   * @yields {Object} Normalized response chunks
   */
  async *query(params) {
    const {
      prompt,
      chatId,
      surfaceId,
      mcpServers: explicitMcpServers,
      allowedTools: explicitAllowedTools,
      maxTurns: explicitMaxTurns,
      systemPrompt: explicitSystemPrompt,
      model: explicitModel,
    } = params;

    // Load surface config if surfaceId is provided, otherwise use defaults
    let surfaceConfig = null;
    if (surfaceId) {
      try {
        surfaceConfig = getSurfaceConfig(surfaceId);
        console.log('[Claude] Loaded surface config for:', surfaceId);
      } catch (err) {
        console.warn('[Claude] Unknown surface:', surfaceId, '- using defaults');
      }
    }

    // Merge: explicit params > surface config > constructor defaults
    const allowedTools = explicitAllowedTools
      || surfaceConfig?.allowedTools
      || this.defaultAllowedTools;
    const maxTurns = explicitMaxTurns
      ?? surfaceConfig?.maxTurns
      ?? this.defaultMaxTurns;
    const mcpServers = explicitMcpServers
      || surfaceConfig?.mcpServers
      || {};
    const systemPrompt = explicitSystemPrompt
      || surfaceConfig?.systemPrompt
      || undefined;
    const model = explicitModel
      || surfaceConfig?.model
      || undefined;
    const permissionMode = surfaceConfig?.permissionMode
      || this.permissionMode;

    // Build query options
    const queryOptions = {
      allowedTools,
      maxTurns,
      mcpServers,
      permissionMode,
      settingSources: ['user', 'project']  // Enable Skills from filesystem
    };

    // Apply system prompt if available
    if (systemPrompt) {
      queryOptions.systemPrompt = systemPrompt;
    }

    // Apply model if available
    if (model) {
      queryOptions.model = model;
    }

    // Bedrock env passthrough: if AWS Bedrock is configured, merge env vars
    // so the Agent SDK uses Bedrock inference instead of direct API
    if (isBedrockConfigured()) {
      queryOptions.env = { ...queryOptions.env, ...getBedrockEnv() };
      console.log('[Claude] Bedrock env configured, routing through AWS');
    }

    // Check for existing session - matches server.js session resumption logic
    const existingSessionId = chatId ? this.getSession(chatId) : null;
    console.log('[Claude] Existing session ID for', chatId, ':', existingSessionId || 'none (new chat)');

    // If we have an existing session, resume it
    if (existingSessionId) {
      queryOptions.resume = existingSessionId;
      console.log('[Claude] Resuming session:', existingSessionId);
    }

    console.log('[Claude] Calling Claude Agent SDK...', surfaceId ? `(surface: ${surfaceId})` : '');

    // Create abort controller for this request
    // Use composite key (surfaceId:chatId) for concurrent surface support
    const abortKey = this.getAbortKey(chatId, surfaceId);
    const abortController = new AbortController();
    if (chatId) {
      this.abortControllers.set(abortKey, abortController);
    }

    try {
    // Stream responses from Claude Agent SDK - matches server.js exactly
    for await (const chunk of query({
      prompt,
      options: queryOptions,
      abortSignal: abortController.signal
    })) {
      // Debug: log all system messages to find session_id
      if (chunk.type === 'system') {
        console.log('[Claude] System message:', JSON.stringify(chunk, null, 2));
      }

      // Capture session ID from system init message - matches server.js logic
      if (chunk.type === 'system' && chunk.subtype === 'init') {
        const newSessionId = chunk.session_id || chunk.data?.session_id || chunk.sessionId;
        if (newSessionId && chatId) {
          this.setSession(chatId, newSessionId);
          console.log('[Claude] Session ID captured:', newSessionId);
          console.log('[Claude] Total sessions stored:', this.sessions.size);
        } else {
          console.log('[Claude] No session_id found in init message');
        }

        // Yield session init event
        if (newSessionId) {
          yield {
            type: 'session_init',
            session_id: newSessionId,
            provider: this.name
          };
        }
        continue;
      }

      // Handle assistant messages - extract text and tool_use blocks
      if (chunk.type === 'assistant' && chunk.message && chunk.message.content) {
        const content = chunk.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              yield {
                type: 'text',
                content: block.text,
                provider: this.name
              };
            } else if (block.type === 'tool_use') {
              yield {
                type: 'tool_use',
                name: block.name,
                input: block.input,
                id: block.id,
                provider: this.name
              };
              console.log('[Claude] Tool use:', block.name);
            }
          }
        }
        continue;
      }

      // Handle tool results
      if (chunk.type === 'tool_result' || chunk.type === 'result') {
        yield {
          type: 'tool_result',
          result: chunk.result || chunk.content || chunk,
          tool_use_id: chunk.tool_use_id,
          provider: this.name
        };
        continue;
      }

      // Skip system chunks, pass through others
      if (chunk.type !== 'system') {
        yield {
          ...chunk,
          provider: this.name
        };
      }
    }

    // Signal completion
    yield {
      type: 'done',
      provider: this.name
    };

    console.log('[Claude] Stream completed');
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Claude] Query aborted for chatId:', chatId);
        yield {
          type: 'aborted',
          provider: this.name
        };
      } else {
        throw error;
      }
    } finally {
      // Clean up abort controller using composite key
      if (chatId) {
        this.abortControllers.delete(abortKey);
      }
    }
  }
}
