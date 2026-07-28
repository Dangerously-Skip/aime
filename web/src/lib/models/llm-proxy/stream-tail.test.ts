import { describe, it, expect } from 'vitest';
import { translateStream } from './stream';

/**
 * The turn must end when the CONTENT ends, not when the upstream connection does.
 *
 * With `stream_options.include_usage` an OpenAI-format stream sends the
 * finish_reason chunk, then a usage-only chunk, then `[DONE]`. The translator
 * used to drain all of it before emitting message_delta/message_stop, so the
 * SDK — and therefore the composer and the Stop button — stayed in "streaming"
 * for the whole tail. OpenRouter can take seconds over it while aggregating
 * billing from the underlying provider, which is why this was visible only on
 * non-Anthropic models: an Anthropic-native stream ends as soon as it is done.
 */

/** A stream whose tail never arrives — the pathological case of a slow tail. */
async function* finishThenHang(): AsyncGenerator<Record<string, unknown>> {
  yield { choices: [{ index: 0, delta: { content: 'hello' } }] };
  yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  // Upstream goes quiet here. Draining would block the turn indefinitely.
  await new Promise(() => {});
}

async function* finishThenUsage(): AsyncGenerator<Record<string, unknown>> {
  yield { choices: [{ index: 0, delta: { content: 'hi' } }] };
  yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 7 } };
}

const collect = async (gen: AsyncGenerator<{ event: string; data: unknown }>) => {
  const out: Array<{ event: string; data: unknown }> = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe('translateStream — ends with the content', () => {
  it('emits message_stop without waiting for a tail that never comes', async () => {
    const events = await Promise.race([
      collect(translateStream(finishThenHang() as never, { messageId: 'msg_1', model: 'm' })),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('blocked on the tail')), 3000)),
    ]);
    const names = events.map((e) => e.event);
    expect(names).toContain('message_delta');
    expect(names[names.length - 1]).toBe('message_stop');
  });

  it('still reports real usage when it arrives with or before the finish chunk', async () => {
    async function* usageWithFinish(): AsyncGenerator<Record<string, unknown>> {
      yield { choices: [{ index: 0, delta: { content: 'hi' } }] };
      yield {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 42 },
      };
    }
    const events = await collect(translateStream(usageWithFinish() as never, { messageId: 'msg_1', model: 'm' }));
    const delta = events.find((e) => e.event === 'message_delta')!.data as {
      usage: { output_tokens: number };
    };
    expect(delta.usage.output_tokens).toBe(42);
  });

  it('falls back to an estimate rather than stalling for a trailing usage chunk', async () => {
    const events = await collect(translateStream(finishThenUsage() as never, { messageId: 'msg_1', model: 'm' }));
    const delta = events.find((e) => e.event === 'message_delta')!.data as {
      usage: { output_tokens: number };
    };
    // Estimated from the emitted characters, not the tail's 7 — the turn had
    // already ended by then.
    expect(delta.usage.output_tokens).toBeGreaterThan(0);
    expect(events[events.length - 1].event).toBe('message_stop');
  });

  it('still closes an open content block before finishing', async () => {
    const events = await collect(translateStream(finishThenUsage() as never, { messageId: 'msg_1', model: 'm' }));
    const names = events.map((e) => e.event);
    expect(names.filter((n) => n === 'content_block_start')).toHaveLength(1);
    expect(names.filter((n) => n === 'content_block_stop')).toHaveLength(1);
    expect(names.indexOf('content_block_stop')).toBeLessThan(names.indexOf('message_stop'));
  });
});
