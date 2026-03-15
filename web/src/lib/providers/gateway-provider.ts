import OpenAI from 'openai';
import { BaseProvider, type QueryParams, type StreamChunk, type ProviderConfig } from './base-provider';
import { mapModelForGateway } from '../gateway-env';

const NIB_GATEWAY_BASE_URL = 'https://ai-studio.internal.invalid/v1';

/**
 * Gateway provider — routes through nib AI Studio (LiteLLM) using the OpenAI-compatible API.
 * Maintains per-chat message history server-side.
 */
export class GatewayProvider extends BaseProvider {
  private chatHistories: Map<string, Array<{ role: 'system' | 'user' | 'assistant'; content: string }>>;
  private abortControllers: Map<string, AbortController>;

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.chatHistories = new Map();
    this.abortControllers = new Map();
  }

  get name(): string {
    return 'gateway';
  }

  abort(chatId: string, surfaceId?: string): boolean {
    const key = this.getAbortKey(chatId, surfaceId);
    const controller = this.abortControllers.get(key);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(key);
      return true;
    }
    return false;
  }

  async *query(params: QueryParams): AsyncGenerator<StreamChunk, void, unknown> {
    const {
      prompt,
      chatId,
      surfaceId,
      model: explicitModel,
      systemPrompt,
      apiKey,
      history: clientHistory,
    } = params;

    if (!apiKey) {
      yield { type: 'error', provider: this.name, message: 'No gateway API key provided' };
      return;
    }

    const client = new OpenAI({
      apiKey,
      baseURL: NIB_GATEWAY_BASE_URL,
    });

    const model = mapModelForGateway(explicitModel);

    // Initialize or retrieve conversation history
    if (!this.chatHistories.has(chatId)) {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      // Add system prompt
      const sysPrompt = typeof systemPrompt === 'string'
        ? systemPrompt
        : typeof systemPrompt === 'object' && systemPrompt !== null
          ? [systemPrompt.preset, systemPrompt.append].filter(Boolean).join('\n\n')
          : undefined;
      if (sysPrompt) {
        messages.push({ role: 'system', content: sysPrompt });
      }
      // Seed from client-side history if available (server state was lost)
      if (clientHistory?.length) {
        for (const msg of clientHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
        console.log('[Gateway] Seeded chat history from client (' + clientHistory.length + ' messages)');
      }
      this.chatHistories.set(chatId, messages);
    }

    const history = this.chatHistories.get(chatId)!;
    history.push({ role: 'user', content: prompt });

    // Create abort controller
    const abortKey = this.getAbortKey(chatId, surfaceId);
    const abortController = new AbortController();
    this.abortControllers.set(abortKey, abortController);

    console.log('[Gateway] Calling nib AI Studio | model:', model, '| messages:', history.length);

    try {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: history,
          stream: true,
        },
        { signal: abortController.signal },
      );

      let fullResponse = '';

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
          yield {
            type: 'text',
            content,
            provider: this.name,
          };
        }
      }

      // Store assistant response in history
      if (fullResponse) {
        history.push({ role: 'assistant', content: fullResponse });
      }

      yield { type: 'done', provider: this.name };
      console.log('[Gateway] Stream completed');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'aborted', provider: this.name };
      } else {
        throw error;
      }
    } finally {
      this.abortControllers.delete(abortKey);
    }
  }

  async cleanup(): Promise<void> {
    this.chatHistories.clear();
    await super.cleanup();
  }
}
