import { describe, it, expect } from 'vitest';
import { translateStream, parseOpenAISSE, serializeSSE, type OpenAIStreamChunk, type AnthropicSSEEvent } from './stream';

async function collect(chunks: OpenAIStreamChunk[], opts?: { inputTokens?: number }): Promise<AnthropicSSEEvent[]> {
  async function* gen() {
    for (const c of chunks) yield c;
  }
  const out: AnthropicSSEEvent[] = [];
  for await (const e of translateStream(gen(), { messageId: 'msg_1', model: 'kimi', inputTokens: opts?.inputTokens ?? 7 })) {
    out.push(e);
  }
  return out;
}

const types = (evts: AnthropicSSEEvent[]) => evts.map((e) => e.event);

describe('translateStream — text', () => {
  it('produces the canonical Anthropic event sequence for a text response', async () => {
    const evts = await collect([
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { completion_tokens: 2 } },
    ]);
    expect(types(evts)).toEqual([
      'message_start',
      'ping',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    // message_start carries input token estimate
    expect((evts[0].data.message as { usage: { input_tokens: number } }).usage.input_tokens).toBe(7);
    // deltas carry the text
    const text = evts
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data.delta as { text: string }).text)
      .join('');
    expect(text).toBe('Hello');
    // stop reason + real usage
    expect((evts.at(-2)!.data.delta as { stop_reason: string }).stop_reason).toBe('end_turn');
    expect((evts.at(-2)!.data.usage as { output_tokens: number }).output_tokens).toBe(2);
  });

  it('estimates output tokens when the upstream omits usage', async () => {
    const evts = await collect([
      { choices: [{ delta: { content: 'abcdefgh' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
    expect((evts.at(-2)!.data.usage as { output_tokens: number }).output_tokens).toBe(2); // ceil(8/4)
  });
});

describe('translateStream — tool use', () => {
  it('opens a tool_use block and streams argument JSON as input_json_delta', async () => {
    const evts = await collect([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'search', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const start = evts.find((e) => e.event === 'content_block_start')!;
    expect(start.data.content_block).toEqual({ type: 'tool_use', id: 'call_1', name: 'search', input: {} });
    const partial = evts
      .filter((e) => e.event === 'content_block_delta')
      .map((e) => (e.data.delta as { partial_json: string }).partial_json)
      .join('');
    expect(partial).toBe('{"q":"cats"}');
    expect((evts.at(-2)!.data.delta as { stop_reason: string }).stop_reason).toBe('tool_use');
  });

  it('closes a text block before opening a tool block, then closes the tool block', async () => {
    const evts = await collect([
      { choices: [{ delta: { content: 'let me search' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'go', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    // text block (index 0) opens+stops, then tool block (index 1) opens+stops
    const seq = types(evts);
    expect(seq).toEqual([
      'message_start',
      'ping',
      'content_block_start', // text
      'content_block_delta',
      'content_block_stop', // text closed
      'content_block_start', // tool
      'content_block_delta',
      'content_block_stop', // tool closed
      'message_delta',
      'message_stop',
    ]);
    const starts = evts.filter((e) => e.event === 'content_block_start');
    expect((starts[0].data as { index: number }).index).toBe(0);
    expect((starts[1].data as { index: number }).index).toBe(1);
  });

  it('handles two parallel tool calls as two content blocks', async () => {
    const evts = await collect([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'g', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    const starts = evts.filter((e) => e.event === 'content_block_start');
    expect(starts).toHaveLength(2);
    expect((starts[0].data.content_block as { id: string }).id).toBe('a');
    expect((starts[1].data.content_block as { id: string }).id).toBe('b');
  });
});

describe('parseOpenAISSE', () => {
  async function* bytes(...frames: string[]) {
    const enc = new TextEncoder();
    for (const f of frames) yield enc.encode(f);
  }

  it('decodes data frames and stops at [DONE]', async () => {
    const out: OpenAIStreamChunk[] = [];
    for await (const c of parseOpenAISSE(
      bytes('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n', 'data: {"x":1}\n\n'),
    )) {
      out.push(c);
    }
    expect(out).toHaveLength(1);
    expect(out[0].choices![0].delta!.content).toBe('hi');
  });

  it('reassembles a frame split across byte chunks', async () => {
    const out: OpenAIStreamChunk[] = [];
    for await (const c of parseOpenAISSE(bytes('data: {"choi', 'ces":[{"delta":{"content":"z"}}]}\n\n'))) {
      out.push(c);
    }
    expect(out[0].choices![0].delta!.content).toBe('z');
  });
});

describe('serializeSSE', () => {
  it('frames an event with event: and data: lines', () => {
    expect(serializeSSE({ event: 'ping', data: { type: 'ping' } })).toBe('event: ping\ndata: {"type":"ping"}\n\n');
  });
});
