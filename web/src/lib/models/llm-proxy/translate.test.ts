import { describe, it, expect } from 'vitest';
import {
  anthropicToOpenAI,
  openAIToAnthropic,
  mapFinishReason,
  parseToolArguments,
  type AnthropicMessagesRequest,
} from './translate';

describe('anthropicToOpenAI', () => {
  it('hoists the system prompt into a leading system message', () => {
    const out = anthropicToOpenAI(
      { model: 'x', system: 'be terse', messages: [{ role: 'user', content: 'hi' }] },
      'gpt-4o',
    );
    expect(out.model).toBe('gpt-4o');
    expect(out.messages[0]).toEqual({ role: 'system', content: 'be terse' });
    expect(out.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('flattens an array-form system prompt', () => {
    const out = anthropicToOpenAI(
      { model: 'x', system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], messages: [] },
      'm',
    );
    expect(out.messages[0]).toEqual({ role: 'system', content: 'a\n\nb' });
  });

  it('maps assistant tool_use blocks to OpenAI tool_calls', () => {
    const req: AnthropicMessagesRequest = {
      model: 'x',
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'search', input: { q: 'cats' } }] },
      ],
    };
    const out = anthropicToOpenAI(req, 'm');
    const asst = out.messages[0] as { role: string; content: string | null; tool_calls?: unknown[] };
    expect(asst.role).toBe('assistant');
    expect(asst.content).toBeNull();
    expect(asst.tool_calls).toEqual([
      { id: 'tu_1', type: 'function', function: { name: 'search', arguments: '{"q":"cats"}' } },
    ]);
  });

  it('turns a user tool_result block into a tool-role message', () => {
    const req: AnthropicMessagesRequest = {
      model: 'x',
      messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'found 3' }] },
      ],
    };
    const out = anthropicToOpenAI(req, 'm');
    expect(out.messages[0]).toEqual({ role: 'tool', tool_call_id: 'tu_1', content: 'found 3' });
  });

  it('splits a tool_result + text user message into a tool message then a user message', () => {
    const req: AnthropicMessagesRequest = {
      model: 'x',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_9', content: [{ type: 'text', text: 'ok' }] },
            { type: 'text', text: 'now summarize' },
          ],
        },
      ],
    };
    const out = anthropicToOpenAI(req, 'm');
    expect(out.messages[0]).toEqual({ role: 'tool', tool_call_id: 'tu_9', content: 'ok' });
    expect(out.messages[1]).toEqual({ role: 'user', content: 'now summarize' });
  });

  it('encodes an image block as an OpenAI data-URL image part', () => {
    const req: AnthropicMessagesRequest = {
      model: 'x',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      ],
    };
    const out = anthropicToOpenAI(req, 'm');
    const parts = (out.messages[0] as { content: Array<{ type: string; image_url?: { url: string } }> }).content;
    expect(parts[1].image_url!.url).toBe('data:image/png;base64,AAAA');
  });

  it('translates tools and tool_choice, and requests usage on stream', () => {
    const req: AnthropicMessagesRequest = {
      model: 'x',
      stream: true,
      max_tokens: 100,
      temperature: 0.4,
      stop_sequences: ['STOP'],
      tools: [{ name: 'lookup', description: 'd', input_schema: { type: 'object', properties: {} } }],
      tool_choice: { type: 'tool', name: 'lookup' },
      messages: [{ role: 'user', content: 'go' }],
    };
    const out = anthropicToOpenAI(req, 'm');
    expect(out.stream).toBe(true);
    expect(out.stream_options).toEqual({ include_usage: true });
    expect(out.max_tokens).toBe(100);
    expect(out.temperature).toBe(0.4);
    expect(out.stop).toEqual(['STOP']);
    expect(out.tools![0]).toEqual({
      type: 'function',
      function: { name: 'lookup', description: 'd', parameters: { type: 'object', properties: {} } },
    });
    expect(out.tool_choice).toEqual({ type: 'function', function: { name: 'lookup' } });
  });

  it('maps tool_choice any → required and auto → auto', () => {
    expect(anthropicToOpenAI({ model: 'x', tool_choice: { type: 'any' }, messages: [] }, 'm').tool_choice).toBe('required');
    expect(anthropicToOpenAI({ model: 'x', tool_choice: { type: 'auto' }, messages: [] }, 'm').tool_choice).toBe('auto');
  });
});

describe('openAIToAnthropic', () => {
  it('maps a text completion with usage', () => {
    const out = openAIToAnthropic(
      {
        id: 'cmpl_1',
        choices: [{ message: { content: 'hello there' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 5 },
      },
      'kimi-k2',
    );
    expect(out.content).toEqual([{ type: 'text', text: 'hello there' }]);
    expect(out.stop_reason).toBe('end_turn');
    expect(out.model).toBe('kimi-k2');
    expect(out.usage).toEqual({ input_tokens: 12, output_tokens: 5 });
  });

  it('maps tool_calls to tool_use blocks and sets stop_reason tool_use', () => {
    const out = openAIToAnthropic(
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      'm',
    );
    expect(out.content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'x' } }]);
    expect(out.stop_reason).toBe('tool_use');
  });

  it('always emits at least one content block', () => {
    const out = openAIToAnthropic({ choices: [{ message: {}, finish_reason: 'stop' }] }, 'm');
    expect(out.content).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('mapFinishReason', () => {
  it('maps the OpenAI reasons', () => {
    expect(mapFinishReason('length')).toBe('max_tokens');
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
    expect(mapFinishReason('stop')).toBe('end_turn');
    expect(mapFinishReason(undefined)).toBe('end_turn');
  });
});

describe('parseToolArguments', () => {
  it('parses valid JSON and tolerates junk', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArguments('')).toEqual({});
    expect(parseToolArguments('not json')).toEqual({});
  });
});
