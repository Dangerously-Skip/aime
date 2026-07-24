/**
 * Streaming translation: an OpenAI chat-completions SSE stream → the Anthropic
 * Messages event stream the Agent SDK expects. Stateful but pure (consumes and
 * yields plain objects) so it can be driven from a scripted chunk array in tests.
 */
import { mapFinishReason, parseToolArguments, type AnthropicStopReason } from './translate';

export interface OpenAIStreamChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface AnthropicSSEEvent {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Parse a raw OpenAI SSE byte stream into decoded chunk objects, stopping at
 * `[DONE]`. Tolerates multi-line frames and partial reads across chunks.
 */
export async function* parseOpenAISSE(
  body: AsyncIterable<Uint8Array>,
): AsyncGenerator<OpenAIStreamChunk> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      if (!payload) continue;
      try {
        yield JSON.parse(payload) as OpenAIStreamChunk;
      } catch {
        // ignore malformed frames
      }
    }
  }
}

/**
 * Translate a stream of OpenAI chunks into Anthropic SSE events. Handles a text
 * block and any number of tool_use blocks, closing each block as content type
 * switches, and emitting the terminating message_delta / message_stop.
 */
export async function* translateStream(
  chunks: AsyncIterable<OpenAIStreamChunk>,
  opts: { messageId: string; model: string; inputTokens?: number },
): AsyncGenerator<AnthropicSSEEvent> {
  const inputTokens = opts.inputTokens ?? 0;
  yield {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: opts.messageId,
        type: 'message',
        role: 'assistant',
        model: opts.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    },
  };
  yield { event: 'ping', data: { type: 'ping' } };

  let nextIndex = 0;
  let openKind: 'text' | 'tool' | null = null;
  let openIndex = -1;
  // OpenAI tool_call array position → our Anthropic content-block index.
  const toolBlockByPos = new Map<number, number>();
  let sawToolCall = false;
  let finishReason: string | null | undefined;
  let outputTokens = 0;
  let approxChars = 0;

  const closeOpen = function* (): Generator<AnthropicSSEEvent> {
    if (openKind !== null) {
      yield { event: 'content_block_stop', data: { type: 'content_block_stop', index: openIndex } };
      openKind = null;
      openIndex = -1;
    }
  };

  for await (const chunk of chunks) {
    if (chunk.usage?.completion_tokens != null) outputTokens = chunk.usage.completion_tokens;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) continue;

    if (typeof delta.content === 'string' && delta.content.length) {
      if (openKind !== 'text') {
        yield* closeOpen();
        openIndex = nextIndex++;
        openKind = 'text';
        yield {
          event: 'content_block_start',
          data: { type: 'content_block_start', index: openIndex, content_block: { type: 'text', text: '' } },
        };
      }
      approxChars += delta.content.length;
      yield {
        event: 'content_block_delta',
        data: { type: 'content_block_delta', index: openIndex, delta: { type: 'text_delta', text: delta.content } },
      };
    }

    for (const tc of delta.tool_calls ?? []) {
      sawToolCall = true;
      let blockIndex = toolBlockByPos.get(tc.index);
      if (blockIndex === undefined) {
        // New tool call — open a tool_use block.
        yield* closeOpen();
        blockIndex = nextIndex++;
        toolBlockByPos.set(tc.index, blockIndex);
        openIndex = blockIndex;
        openKind = 'tool';
        yield {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'tool_use', id: tc.id || `tool_${blockIndex}`, name: tc.function?.name || '', input: {} },
          },
        };
      }
      const args = tc.function?.arguments;
      if (typeof args === 'string' && args.length) {
        approxChars += args.length;
        yield {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: args } },
        };
      }
    }
  }

  yield* closeOpen();

  const stopReason: AnthropicStopReason = sawToolCall ? 'tool_use' : mapFinishReason(finishReason);
  if (outputTokens === 0) outputTokens = Math.max(1, Math.ceil(approxChars / 4));
  yield {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
  };
  yield { event: 'message_stop', data: { type: 'message_stop' } };
}

/** Serialize an Anthropic SSE event into wire framing. */
export function serializeSSE(evt: AnthropicSSEEvent): string {
  return `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
}

// Re-exported for the tool-argument JSON tolerance used by the non-stream path.
export { parseToolArguments };
