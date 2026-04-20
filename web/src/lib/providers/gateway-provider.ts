import OpenAI from 'openai';
import { BaseProvider, type QueryParams, type StreamChunk, type ProviderConfig } from './base-provider';
import { mapModelForGateway } from '../gateway-env';

const NIB_GATEWAY_BASE_URL = 'https://ai-studio.internal.invalid/v1';
const MAX_NATIVE_BYTES = 20 * 1024 * 1024; // 20 MB — skip native upload above this

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }
  | { type: 'file'; file: { filename: string; file_data: string } };

type MessageContent = string | ContentPart[];

/**
 * Gateway provider — routes through nib AI Studio (LiteLLM) using the OpenAI-compatible API.
 * Maintains per-chat message history server-side.
 * Supports multimodal content (images, PDFs) as native content blocks.
 */
export class GatewayProvider extends BaseProvider {
  private chatHistories: Map<string, Array<{ role: 'system' | 'user' | 'assistant'; content: MessageContent }>>;
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
      attachments,
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
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: MessageContent }> = [];
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

    // Build user message — multimodal when image/PDF attachments are present
    const nativeAttachments = (attachments || []).filter(
      a => a.category === 'image' || (a.category === 'document' && a.type === 'application/pdf')
    );
    const extractedAttachments = (attachments || []).filter(
      a => a.content && a.category !== 'image' && !(a.category === 'document' && a.type === 'application/pdf')
    );

    if (nativeAttachments.length > 0) {
      const parts: ContentPart[] = [];

      // Inline extracted document text (DOCX, XLSX, etc) as text parts
      for (const att of extractedAttachments) {
        if (att.content) {
          parts.push({ type: 'text', text: `<document name="${att.name}">\n${att.content}\n</document>` });
        }
      }

      // Add native image/PDF parts
      for (const att of nativeAttachments) {
        if (!att.content) continue;

        // Size guard — skip native upload for very large files
        const base64Data = att.content.includes(',') ? att.content.split(',')[1] : att.content;
        const byteSize = Math.ceil(base64Data.length * 3 / 4);
        if (byteSize > MAX_NATIVE_BYTES) {
          parts.push({ type: 'text', text: `[Attachment ${att.name} too large for native upload (${(byteSize / 1024 / 1024).toFixed(1)}MB). Please use a smaller file.]` });
          continue;
        }

        if (att.category === 'image') {
          const dataUrl = att.content.startsWith('data:') ? att.content : `data:${att.type || 'image/png'};base64,${att.content}`;
          parts.push({ type: 'image_url', image_url: { url: dataUrl } });
          console.log('[Gateway] Added native image:', att.name);
        } else if (att.category === 'document' && att.type === 'application/pdf') {
          const pdfDataUrl = att.content.startsWith('data:') ? att.content : `data:application/pdf;base64,${att.content}`;
          parts.push({ type: 'file', file: { filename: att.name, file_data: pdfDataUrl } });
          console.log('[Gateway] Added native PDF:', att.name);
        }
      }

      // Add the user's text message
      parts.push({ type: 'text', text: prompt });
      history.push({ role: 'user', content: parts });
      console.log('[Gateway] Built multimodal message with', parts.length, 'content parts');
    } else if (extractedAttachments.length > 0) {
      // Text-only attachments: inline as document tags (existing behavior)
      const inlineParts = extractedAttachments
        .filter(a => a.content)
        .map(a => `<document name="${a.name}">\n${a.content}\n</document>`);
      const finalPrompt = inlineParts.length > 0
        ? `${inlineParts.join('\n\n')}\n\n${prompt}`
        : prompt;
      history.push({ role: 'user', content: finalPrompt });
    } else {
      // No attachments — plain text message
      history.push({ role: 'user', content: prompt });
    }

    // Create abort controller
    const abortKey = this.getAbortKey(chatId, surfaceId);
    const abortController = new AbortController();
    this.abortControllers.set(abortKey, abortController);

    console.log('[Gateway] Calling nib AI Studio | model:', model, '| messages:', history.length);

    try {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: history as OpenAI.ChatCompletionMessageParam[],
          stream: true,
          // MCP tools for server-side web search via LiteLLM
          tools: [
            {
              type: 'mcp' as any,
              server_label: 'searxng_search',
              server_url: 'litellm_proxy',
              require_approval: 'never',
            } as any,
          ],
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
