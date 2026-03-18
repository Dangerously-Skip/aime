import { query } from '@anthropic-ai/claude-agent-sdk';
import { BaseProvider, type QueryParams, type StreamChunk, type ProviderConfig } from './base-provider';
import { getSurfaceConfig } from '../surfaces';
import { getBedrockEnv, isBedrockConfigured } from '../bedrock-env';
import { getGatewayEnv, isGatewayConfigured, mapModelForGateway } from '../gateway-env';
import { waitForAnswer } from '../pending-questions';
import { BROWSER_TOOL_NAMES } from '../browser-tools';
import { waitForBrowserToolResult } from '../pending-browser-tools';

/**
 * Cached system:init data from the most recent session.
 */
export interface SystemInitData {
  skills?: unknown[];
  plugins?: unknown[];
  mcp_servers?: unknown[];
  slash_commands?: unknown[];
  agents?: unknown[];
  [key: string]: unknown;
}

/**
 * Claude Agent SDK provider implementation.
 * Matches the exact behavior from the original server.js.
 */
export class ClaudeProvider extends BaseProvider {
  private defaultAllowedTools: string[];
  private defaultMaxTurns: number;
  private permissionMode: string;
  private abortControllers: Map<string, AbortController>;
  public lastInitData: SystemInitData | null = null;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.defaultAllowedTools = config.allowedTools || [
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'WebSearch', 'WebFetch', 'TodoWrite', 'Skill',
    ];
    this.defaultMaxTurns = config.maxTurns || 20;
    this.permissionMode = config.permissionMode || 'bypassPermissions';
    this.abortControllers = new Map();
  }

  get name(): string {
    return 'claude';
  }

  /**
   * Scan ~/.claude/plugins/ for local plugin directories.
   */
  private async scanPlugins(): Promise<string[]> {
    try {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const pluginsDir = path.join(os.homedir(), '.claude', 'plugins');
      if (!fs.existsSync(pluginsDir)) return [];
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => path.join(pluginsDir, e.name));
    } catch {
      return [];
    }
  }

  /**
   * Abort an active query for a given chatId (and optional surfaceId).
   */
  abort(chatId: string, surfaceId?: string): boolean {
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
   * Execute a query using Claude Agent SDK.
   * Supports optional surface-routed configuration via surfaceId.
   */
  async *query(params: QueryParams): AsyncGenerator<StreamChunk, void, unknown> {
    const {
      prompt,
      chatId,
      surfaceId,
      mcpServers: explicitMcpServers,
      allowedTools: explicitAllowedTools,
      maxTurns: explicitMaxTurns,
      systemPrompt: explicitSystemPrompt,
      model: explicitModel,
      attachments,
      apiKey,
      cwd,
      history,
      onInputRequest,
      onBrowserToolUse,
    } = params;

    // Load surface config if surfaceId is provided, otherwise use defaults
    let surfaceConfig: ReturnType<typeof getSurfaceConfig> | null = null;
    if (surfaceId) {
      try {
        surfaceConfig = getSurfaceConfig(surfaceId);
        console.log('[Claude] Loaded surface config for:', surfaceId);
      } catch {
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

    // Scan for installed plugins to pass to SDK
    const pluginPaths = await this.scanPlugins();

    // Build query options
    const queryOptions: Record<string, unknown> = {
      allowedTools,
      maxTurns,
      mcpServers,
      permissionMode,
      settingSources: ['user', 'project'], // Enable Skills from filesystem
      ...(pluginPaths.length > 0 && {
        plugins: pluginPaths.map(p => ({ type: 'local', path: p })),
      }),
    };

    // Intercept AskUserQuestion and browser tools via canUseTool.
    // canUseTool is called even with bypassPermissions for AskUserQuestion
    // since the SDK needs to collect user answers for that tool.
    if (onInputRequest || onBrowserToolUse) {
      queryOptions.canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        { toolUseID }: { toolUseID: string },
      ) => {
        // Handle AskUserQuestion
        if (toolName === 'AskUserQuestion' && onInputRequest) {
          await onInputRequest(toolUseID, input.questions);
          const answers = await waitForAnswer(toolUseID);
          return {
            behavior: 'allow' as const,
            updatedInput: { ...input, answers },
          };
        }

        // Handle browser tools — send to client webview for execution
        if (BROWSER_TOOL_NAMES.has(toolName) && onBrowserToolUse) {
          console.log('[Claude] Intercepting browser tool:', toolName, 'id:', toolUseID);
          await onBrowserToolUse(toolUseID, toolName, input);
          const result = await waitForBrowserToolResult(toolUseID);
          return {
            behavior: 'allow' as const,
            updatedInput: { ...input, __browserToolResult: result.output, __isError: result.isError },
          };
        }

        return { behavior: 'allow' as const };
      };
    }

    // Set working directory — use selected folder, or fall back to a safe temp
    // directory so the agent never defaults to the app's own source tree.
    if (cwd) {
      queryOptions.cwd = cwd;
      console.log('[Claude] Working directory set to:', cwd);
    } else {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const safeCwd = path.join(os.tmpdir(), 'quarry-sandbox');
      fs.mkdirSync(safeCwd, { recursive: true });
      queryOptions.cwd = safeCwd;
      console.log('[Claude] No folder selected — using safe temp directory:', safeCwd);
    }

    // Apply system prompt if available
    if (systemPrompt) {
      queryOptions.systemPrompt = systemPrompt;
    }

    // Apply model if available
    if (model) {
      queryOptions.model = model;
    }

    // IMPORTANT: Always strip CLAUDECODE from subprocess env to prevent
    // "nested session" detection when the app is launched from a Claude Code terminal.
    const { CLAUDECODE: _cc, ...safeEnv } = process.env;
    queryOptions.env = { ...safeEnv };

    // Gateway env passthrough: if nib Gateway API key is provided, route through gateway
    // This takes priority over Bedrock env
    if (apiKey && isGatewayConfigured(apiKey)) {
      queryOptions.env = {
        ...safeEnv,
        ...(queryOptions.env as Record<string, string> || {}),
        ...getGatewayEnv(apiKey),
        // Gateway LiteLLM doesn't support adaptive thinking — disable it via CLI env var
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
      };
      // Override model to use gateway-compatible short names
      queryOptions.model = mapModelForGateway(model);
      console.log('[Claude] Gateway configured, routing through nib AI Studio');
    } else if (isBedrockConfigured()) {
      queryOptions.env = { ...safeEnv, ...(queryOptions.env as Record<string, string> || {}), ...getBedrockEnv() };
      console.log('[Claude] Bedrock env configured, routing through AWS');
    }

    // Check for existing session - matches server.js session resumption logic
    // Skip resume if the working directory changed (session cwd is baked in)
    const existingSessionId = chatId ? this.getSession(chatId) : null;
    const previousCwd = chatId ? this.getSessionCwd(chatId) : null;
    // Detect cwd change: if cwd is provided and either there was no previous cwd
    // stored or it differs, treat it as a change so we start a fresh session.
    const cwdChanged = cwd ? (!previousCwd || cwd !== previousCwd) : false;
    if (cwdChanged) {
      console.log('[Claude] Working directory changed from', previousCwd || '(none)', 'to', cwd, '- starting fresh session');
    } else {
      console.log('[Claude] Existing session ID for', chatId, ':', existingSessionId || 'none (new chat)');
    }

    // If we have an existing session and cwd hasn't changed, resume it
    if (existingSessionId && !cwdChanged) {
      queryOptions.resume = existingSessionId;
      console.log('[Claude] Resuming session:', existingSessionId);
    }

    // Build prompt — prepend conversation history as XML when no session to resume
    let queryPrompt: unknown = prompt;
    if (!existingSessionId && history?.length) {
      const historyXml = history
        .map((m) => `<msg role="${m.role}">${m.content}</msg>`)
        .join('\n');
      queryPrompt = `<conversation_history>\n${historyXml}\n</conversation_history>\n\n${prompt}`;
      console.log('[Claude] Prepended conversation history (' + history.length + ' messages) as XML fallback');
    }

    // Use content blocks array when attachments are present
    if (attachments && attachments.length > 0) {
      const contentBlocks: unknown[] = [];

      for (const att of attachments) {
        if (att.category === 'image') {
          // Extract base64 data and media type from data URL
          const match = att.content.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1],
                data: match[2],
              },
            });
          }
        } else if (att.category === 'document') {
          // PDF: content is already raw base64
          contentBlocks.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: att.content,
            },
          });
        } else {
          // Text files: inline as text block
          contentBlocks.push({
            type: 'text',
            text: `[File: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``,
          });
        }
      }

      // Add user message as final text block
      contentBlocks.push({ type: 'text', text: prompt });
      queryPrompt = contentBlocks;
      console.log('[Claude] Using content blocks with', attachments.length, 'attachment(s)');
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
        prompt: queryPrompt,
        options: queryOptions,
        abortSignal: abortController.signal,
      } as Parameters<typeof query>[0])) {
        const c = chunk as Record<string, unknown>;

        // Debug: log all system messages to find session_id
        if (c.type === 'system') {
          console.log('[Claude] System message:', JSON.stringify(c, null, 2));
        }

        // Capture session ID and system:init data - matches server.js logic
        if (c.type === 'system' && c.subtype === 'init') {
          const newSessionId = (c.session_id || (c.data as Record<string, unknown>)?.session_id || c.sessionId) as string | undefined;
          if (newSessionId && chatId) {
            this.setSession(chatId, newSessionId, cwd);
            console.log('[Claude] Session ID captured:', newSessionId);
            console.log('[Claude] Total sessions stored:', this.sessions.size);
          } else {
            console.log('[Claude] No session_id found in init message');
          }

          // Cache system:init data for introspection
          const initData: SystemInitData = {};
          const data = (c.data || c) as Record<string, unknown>;
          if (data.skills) initData.skills = data.skills as unknown[];
          if (data.plugins) initData.plugins = data.plugins as unknown[];
          if (data.mcp_servers) initData.mcp_servers = data.mcp_servers as unknown[];
          if (data.slash_commands) initData.slash_commands = data.slash_commands as unknown[];
          if (data.agents) initData.agents = data.agents as unknown[];
          this.lastInitData = initData;
          console.log('[Claude] system:init data cached:', Object.keys(initData).join(', '));

          // Yield session init event with system:init data
          if (newSessionId) {
            yield {
              type: 'session_init',
              session_id: newSessionId,
              provider: this.name,
            };
          }

          // Yield system_init event to forward data to client
          yield {
            type: 'system_init',
            ...initData,
            provider: this.name,
          };

          continue;
        }

        // Handle assistant messages - extract text and tool_use blocks
        if (c.type === 'assistant' && c.message) {
          // A new assistant message means any previous turn's tools have finished executing.
          yield { type: 'turn_start', provider: this.name };

          const message = c.message as Record<string, unknown>;
          const content = message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                yield {
                  type: 'text',
                  content: block.text as string,
                  provider: this.name,
                };
              } else if (block.type === 'tool_use') {
                yield {
                  type: 'tool_use',
                  name: block.name as string,
                  input: block.input as Record<string, unknown>,
                  id: block.id as string,
                  provider: this.name,
                };
                console.log('[Claude] Tool use:', block.name);
              }
            }
          }
          continue;
        }

        // Handle tool results — try multiple field names for the tool use ID
        // since different SDK versions may use different conventions
        if (c.type === 'tool_result' || c.type === 'result') {
          const toolUseId = (c.tool_use_id || c.toolUseId || c.id) as string;
          yield {
            type: 'tool_result',
            result: (c.result || c.content || c) as unknown,
            tool_use_id: toolUseId,
            provider: this.name,
          };
          continue;
        }

        // Skip system chunks, pass through others
        if (c.type !== 'system') {
          yield {
            ...(c as StreamChunk),
            provider: this.name,
          };
        }
      }

      // Signal completion
      yield {
        type: 'done',
        provider: this.name,
      };

      console.log('[Claude] Stream completed');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[Claude] Query aborted for chatId:', chatId);
        yield {
          type: 'aborted',
          provider: this.name,
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
