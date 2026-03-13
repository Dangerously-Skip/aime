import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';
import { BaseProvider, type QueryParams, type StreamChunk, type ProviderConfig } from './base-provider';

interface McpServerConfig {
  type: string;
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  environment?: Record<string, string>;
}

/**
 * Opencode SDK provider implementation.
 * Adapts Opencode SDK to match the same interface as Claude provider.
 */
export class OpencodeProvider extends BaseProvider {
  private client: ReturnType<typeof createOpencodeClient> | null;
  private serverInstance: unknown | null;
  private defaultModel: string | undefined;
  private hostname: string;
  private port: number;
  private useExistingServer: boolean;
  private existingServerUrl: string | null;
  private abortControllers: Map<string, AbortController>;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.client = null;
    this.serverInstance = null;
    this.defaultModel = config.model;
    this.hostname = config.hostname || '127.0.0.1';
    this.port = config.port || 4096;
    this.useExistingServer = config.useExistingServer || false;
    this.existingServerUrl = config.existingServerUrl || null;
    this.abortControllers = new Map();
  }

  get name(): string {
    return 'opencode';
  }

  /**
   * Abort an active query for a given chatId.
   */
  abort(chatId: string): boolean {
    const controller = this.abortControllers.get(chatId);
    if (controller) {
      console.log('[Opencode] Aborting query for chatId:', chatId);
      controller.abort();
      this.abortControllers.delete(chatId);
      return true;
    }
    return false;
  }

  /**
   * Initialize the Opencode client/server.
   */
  async initialize(): Promise<void> {
    if (this.client) return;

    try {
      if (this.useExistingServer && this.existingServerUrl) {
        // Connect to existing Opencode server
        console.log('[Opencode] Connecting to existing server:', this.existingServerUrl);
        this.client = createOpencodeClient({
          baseUrl: this.existingServerUrl,
        }) as ReturnType<typeof createOpencodeClient>;
      } else {
        // Create new Opencode server and client
        console.log('[Opencode] Creating new server on', this.hostname, ':', this.port);
        const result = await createOpencode({
          hostname: this.hostname,
          port: this.port,
        });
        this.client = result.client as ReturnType<typeof createOpencodeClient>;
        this.serverInstance = result.server;
      }
      console.log('[Opencode] Initialized successfully');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Opencode] Initialization error:', message);
      throw error;
    }
  }

  /**
   * Build MCP server config for Opencode format.
   * Converts from Claude-style mcpServers to Opencode format.
   */
  buildMcpConfig(mcpServers: Record<string, McpServerConfig>): Record<string, unknown> {
    const mcpConfig: Record<string, unknown> = {};

    for (const [name, config] of Object.entries(mcpServers)) {
      if (config.type === 'http' || config.type === 'remote') {
        mcpConfig[name] = {
          type: 'remote',
          url: config.url,
          headers: config.headers || {},
        };
      } else if (config.type === 'local') {
        mcpConfig[name] = {
          type: 'local',
          command: config.command,
          environment: config.environment || {},
        };
      }
    }

    return mcpConfig;
  }

  /**
   * Execute a query using Opencode SDK.
   * Matches the same interface as Claude provider.
   */
  async *query(params: QueryParams): AsyncGenerator<StreamChunk, void, unknown> {
    const {
      prompt,
      chatId,
      mcpServers = {},
      model = null,
    } = params;

    // Use provided model or fall back to default
    const modelToUse = model || this.defaultModel || 'opencode/big-pickle';
    console.log('[Opencode] Using model:', modelToUse);

    // Ensure client is initialized
    await this.initialize();

    // Check for existing session
    let sessionId = chatId ? this.getSession(chatId) : null;
    console.log('[Opencode] Session for', chatId, ':', sessionId || 'new');

    // Create abort controller for this request
    const abortController = new AbortController();
    if (chatId) {
      this.abortControllers.set(chatId, abortController);
    }

    try {
      // Note: MCP servers are configured in opencode.json, not passed via API
      // The backend server.js writes the Composio MCP URL to opencode.json

      // Create session if needed
      if (!sessionId) {
        console.log('[Opencode] Creating session with model:', modelToUse);
        const sessionResult = await this.client!.session.create({
          body: {
            config: {
              model: modelToUse,
            },
          },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        const data = sessionResult as Record<string, unknown>;
        sessionId = ((data.data as Record<string, unknown>)?.id || data.id) as string;
        if (chatId && sessionId) {
          this.setSession(chatId, sessionId);
        }
        console.log('[Opencode] Session:', sessionId);

        yield {
          type: 'session_init',
          session_id: sessionId,
          provider: this.name,
        };
      }

      // Parse model string into providerID and modelID
      const [providerID, ...modelParts] = modelToUse.split('/');
      const modelID = modelParts.join('/');

      console.log('[Opencode] Subscribing to events...');

      // Subscribe to events for streaming
      const events = await this.client!.event.subscribe();

      // Send prompt async (returns immediately, results come via events)
      console.log('[Opencode] Sending prompt async...');
      await this.client!.session.promptAsync({
        path: { id: sessionId! },
        body: {
          model: { providerID, modelID },
          parts: [{ type: 'text', text: prompt }],
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      console.log('[Opencode] Listening for events...');

      // Track assistant's text parts (accumulates as streaming happens)
      let userMessageId: string | null = null;
      const lastYieldedLength = new Map<string, number>(); // partId -> length already yielded
      const yieldedToolCalls = new Set<string>(); // callID -> prevent duplicate tool yields

      // Listen to event stream
      const stream = (events as Record<string, unknown>).stream as AsyncIterable<Record<string, unknown>>;
      for await (const event of stream) {
        // Check if aborted
        if (abortController.signal.aborted) {
          console.log('[Opencode] Query aborted, breaking event loop');
          break;
        }

        const props = (event.properties || {}) as Record<string, unknown>;
        const part = (props.part || props) as Record<string, unknown>;
        const eventSessionId = (props.sessionID || part?.sessionID || (props.session as Record<string, unknown>)?.id) as string | undefined;

        // Filter events for our session
        if (eventSessionId && eventSessionId !== sessionId) {
          continue;
        }

        if (event.type === 'message.part.updated') {
          const messageId = part?.messageID as string | undefined;
          const partId = part?.id as string | undefined;

          // Skip user's message (first text message we see)
          if (!userMessageId && part?.type === 'text') {
            userMessageId = messageId || null;
            continue;
          }

          // Skip parts from user's message
          if (messageId === userMessageId) {
            continue;
          }

          // Handle streaming text - yield only the NEW delta
          if (part?.type === 'text' && part?.text) {
            const prevLength = lastYieldedLength.get(partId!) || 0;
            const fullText = part.text as string;

            if (fullText.length > prevLength) {
              const delta = fullText.slice(prevLength);
              yield {
                type: 'text',
                content: delta,
                provider: this.name,
              };
              lastYieldedLength.set(partId!, fullText.length);
            }
          } else if (part?.type === 'reasoning') {
            const text = (part.reasoning || part.text || '') as string;
            const prevLength = lastYieldedLength.get(partId!) || 0;

            if (text.length > prevLength) {
              const delta = text.slice(prevLength);
              yield {
                type: 'text',
                content: delta,
                provider: this.name,
                isReasoning: true,
              };
              lastYieldedLength.set(partId!, text.length);
            }
          } else if (part?.type === 'tool-invocation' || part?.type === 'tool_invocation' || part?.type === 'tool') {
            const toolId = (part.toolInvocationId || part.callID || part.id || part.tool_invocation_id) as string;

            // Skip if we've already yielded this tool call
            if (yieldedToolCalls.has(toolId)) {
              continue;
            }
            const state = part.state as Record<string, unknown> | undefined;
            if (state?.status === 'pending') {
              console.log('[Opencode] Skipping pending tool call:', part.tool);
              continue;
            }

            const toolName = (part.toolName || part.tool || part.name) as string;
            const toolArgs = (state?.input || part.args || part.input || part.parameters || part.params || part.toolInput || {}) as Record<string, unknown>;

            console.log('[Opencode] Tool:', toolName, 'args:', JSON.stringify(toolArgs).slice(0, 80));

            yieldedToolCalls.add(toolId);

            yield {
              type: 'tool_use',
              name: toolName,
              input: toolArgs,
              id: toolId,
              provider: this.name,
            };
          } else if (part?.type === 'tool-result' || part?.type === 'tool_result') {
            const toolId = (part.toolInvocationId || part.callID || part.id || part.tool_invocation_id) as string;
            const resultData = part.result || part.output || part.content;
            console.log('[Opencode] Tool result detected:', toolId, 'result:', JSON.stringify(resultData).slice(0, 100));
            yield {
              type: 'tool_result',
              result: resultData,
              tool_use_id: toolId,
              provider: this.name,
            };
          } else if (part?.type === 'step-start' || part?.type === 'step-finish') {
            // Skip step markers
            console.log('[Opencode] Skipping step marker:', part.type);
          } else {
            console.log('[Opencode] Unhandled part type:', part?.type, 'full part:', JSON.stringify(part).slice(0, 200));
          }
        } else if (event.type === 'message.updated') {
          // Just log - parts come from message.part.updated, not here
          const message = (props.message || props) as Record<string, unknown>;
          const info = message?.info as Record<string, unknown> | undefined;
          console.log(' Msg updated:', info?.role, 'id:', (info?.id as string)?.slice(-10));
        } else if (event.type === 'session.idle') {
          console.log('[Opencode] Session idle - done');
          break;
        } else if (event.type === 'session.error') {
          console.error('[Opencode] Session error:', props);
          yield {
            type: 'error',
            message: (props.message as string) || 'Session error',
            provider: this.name,
          };
          break;
        }
      }

      // Check if we were aborted
      if (abortController.signal.aborted) {
        yield {
          type: 'aborted',
          provider: this.name,
        };
        console.log('[Opencode] Stream aborted');
      } else {
        yield {
          type: 'done',
          provider: this.name,
        };
        console.log('[Opencode] Stream completed');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Opencode] Query error:', message);
      yield {
        type: 'error',
        message,
        provider: this.name,
      };
    } finally {
      // Clean up abort controller
      if (chatId) {
        this.abortControllers.delete(chatId);
      }
    }
  }

  /**
   * Normalize a streaming chunk to match Claude provider output format.
   */
  normalizeChunk(chunk: Record<string, unknown>): StreamChunk | null {
    if (!chunk) return null;

    // Handle different chunk types from Opencode
    if (chunk.type === 'text' || chunk.type === 'content') {
      return {
        type: 'text',
        content: (chunk.text || chunk.content || '') as string,
        provider: this.name,
      };
    }

    if (chunk.type === 'tool_use' || chunk.type === 'tool_call') {
      console.log('[Opencode] Tool use:', chunk.name || chunk.tool);
      return {
        type: 'tool_use',
        name: (chunk.name || chunk.tool) as string,
        input: (chunk.input || chunk.arguments || {}) as Record<string, unknown>,
        id: (chunk.id || chunk.tool_call_id) as string,
        provider: this.name,
      };
    }

    if (chunk.type === 'tool_result') {
      return {
        type: 'tool_result',
        result: chunk.result || chunk.output || chunk.content,
        tool_use_id: (chunk.tool_use_id || chunk.tool_call_id) as string,
        provider: this.name,
      };
    }

    // Pass through other chunk types
    return {
      ...(chunk as unknown as StreamChunk),
      provider: this.name,
    };
  }

  /**
   * Normalize a complete message to chunks.
   */
  normalizeMessage(message: Record<string, unknown>): StreamChunk[] | null {
    if (!message) return null;

    const chunks: StreamChunk[] = [];

    // Handle message parts/content
    if (message.parts && Array.isArray(message.parts)) {
      for (const part of message.parts) {
        if (part.type === 'text') {
          chunks.push({
            type: 'text',
            content: part.text as string,
            provider: this.name,
          });
        } else if (part.type === 'tool-invocation') {
          chunks.push({
            type: 'tool_use',
            name: part.toolName as string,
            input: part.args as Record<string, unknown>,
            id: part.toolInvocationId as string,
            provider: this.name,
          });
          console.log('[Opencode] Tool use:', part.toolName);
        } else if (part.type === 'tool-result') {
          chunks.push({
            type: 'tool_result',
            result: part.result,
            tool_use_id: part.toolInvocationId as string,
            provider: this.name,
          });
        }
      }
    } else if (message.content) {
      // Simple text content
      chunks.push({
        type: 'text',
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        provider: this.name,
      });
    }

    return chunks.length > 0 ? chunks : null;
  }

  /**
   * Cleanup resources.
   */
  async cleanup(): Promise<void> {
    await super.cleanup();
    if (this.serverInstance) {
      // Close server if we created it
      try {
        await (this.serverInstance as { close(): Promise<void> }).close();
        console.log('[Opencode] Server closed');
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[Opencode] Error closing server:', message);
      }
    }
    this.client = null;
    this.serverInstance = null;
  }
}
