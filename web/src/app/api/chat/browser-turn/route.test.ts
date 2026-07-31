import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The first tests for the browser surface. All 2,084 lines of it shipped without
 * any, which is how it kept a second inference path — a bare `new Anthropic()`
 * with a hardcoded 3-entry model map pinned to a DEPRECATED Claude 4 generation,
 * and a key that had to come from the browser — long after the model registry
 * existed. Nothing failed, because nothing was asserting.
 *
 * What is mocked and what is not is the whole point here. `@anthropic-ai/sdk` is
 * mocked: it is the network, and these tests are not about whether Anthropic
 * answers. The model registry, `resolveExecution` and the credential store are
 * REAL — they are the boundary this route exists to sit behind, and mocking them
 * would leave us asserting that the route calls the code we told it to call,
 * which is the failure mode `security-section.enforcement.test.ts` documents.
 */
const { anthropicCtor, streamMock } = vi.hoisted(() => ({
  anthropicCtor: vi.fn(),
  streamMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class FakeAnthropic {
    messages: { stream: typeof streamMock };
    constructor(opts: Record<string, unknown>) {
      anthropicCtor(opts);
      this.messages = { stream: streamMock };
    }
  }
  return { default: FakeAnthropic };
});

import { POST } from './route';

/** Drain the SSE body so the route's floating async writer runs to completion. */
async function post(body: unknown): Promise<{ status: number; json: () => Promise<unknown> }> {
  const res = await POST(
    new NextRequest('http://localhost/api/chat/browser-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  if (res.headers.get('content-type')?.includes('event-stream')) await res.text();
  return res;
}

const messages = [{ role: 'user' as const, content: 'hi' }];

/** The model id handed to the Messages API on the last call. */
const sentModel = () => (streamMock.mock.calls.at(-1)?.[0] as { model: string } | undefined)?.model;

let priorEnvKey: string | undefined;

beforeEach(() => {
  anthropicCtor.mockReset();
  streamMock.mockReset();
  streamMock.mockImplementation(() => ({
    on: vi.fn(),
    finalMessage: async () => ({ stop_reason: 'end_turn', usage: { output_tokens: 1 } }),
  }));
  priorEnvKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-env-key';
});

afterEach(() => {
  if (priorEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorEnvKey;
});

describe('POST /api/chat/browser-turn — validation', () => {
  it('requires a messages array', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ messages: [] })).status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe('the model comes from the registry, not from this route', () => {
  /**
   * The regression that matters. The old map sent `claude-sonnet-4-20250514` —
   * a deprecated generation — while every other surface went through the Agent
   * SDK and got current models for free. Asserting "not Claude 4" is what makes
   * a future staleness of the same kind fail here.
   */
  it('resolves an unpinned request through the registry to a current model', async () => {
    await post({ messages });
    expect(sentModel()).toBe('claude-sonnet-5');
  });

  it('never sends a bare SDK alias — the Messages API does not accept one', async () => {
    for (const model of [null, 'sonnet', 'opus', 'haiku']) {
      await post({ messages, model });
      expect(['sonnet', 'opus', 'haiku'], `alias ${model} leaked`).not.toContain(sentModel());
    }
  });

  it('maps each alias to its current concrete id', async () => {
    await post({ messages, model: 'opus' });
    expect(sentModel()).toBe('claude-opus-5');
    await post({ messages, model: 'haiku' });
    expect(sentModel()).toBe('claude-haiku-4-5');
    await post({ messages, model: 'fable' });
    expect(sentModel()).toBe('claude-fable-5');
  });

  it('passes a concrete id straight through', async () => {
    await post({ messages, model: 'claude-opus-4-8' });
    expect(sentModel()).toBe('claude-opus-4-8');
  });

  it('honours an explicit capability/tier over the surface default', async () => {
    await post({ messages, capability: 'chat', tier: 'cheap' });
    expect(sentModel()).toBe('claude-haiku-4-5');
  });
});

describe('credentials are resolved server-side', () => {
  /**
   * The user-facing bug: the client refused the turn unless a key was in its own
   * settings store, so the surface was dead for anyone using env, the encrypted
   * credential store, or a user-added provider.
   */
  it('runs with no client-supplied key when the server has one', async () => {
    await post({ messages });
    expect(streamMock).toHaveBeenCalled();
    expect(anthropicCtor.mock.calls[0][0].apiKey).toBe('sk-env-key');
  });

  it('prefers a key supplied on the request', async () => {
    await post({ messages, apiKey: 'sk-from-request' });
    expect(anthropicCtor.mock.calls[0][0].apiKey).toBe('sk-from-request');
  });

  it('refuses with an actionable message when there is no key anywhere', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({ messages });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/Settings|ANTHROPIC_API_KEY/);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('drives a user-added provider through its own base URL', async () => {
    await post({
      messages,
      apiKey: 'sk-x',
      providerConfig: { providerId: 'openrouter', baseUrl: 'https://openrouter.ai/api' },
    });
    expect(anthropicCtor.mock.calls[0][0].baseURL).toContain('openrouter.ai');
  });
});

describe('Bedrock and Vertex are refused by name, not mislabelled', () => {
  /**
   * This route calls the Messages API directly, and Bedrock/Vertex are driven by
   * the Agent SDK subprocess's ENVIRONMENT (`CLAUDE_CODE_USE_BEDROCK=1`), which a
   * raw HTTP client cannot consume. So it genuinely cannot serve them.
   *
   * The old code said "ANTHROPIC_API_KEY not configured", which sent a Bedrock
   * user hunting for a key they correctly do not have. The assertion below is on
   * the WORDING for that reason: an honest error is the deliverable here.
   */
  it.each([
    ['bedrock', /Bedrock/],
    ['vertex', /Vertex/],
  ])('refuses %s with a message naming it', async (agentMode, expected) => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post({
      messages,
      providerConfig: { providerId: agentMode, agentMode },
    });
    expect(res.status).toBe(501);
    const body = JSON.stringify(await res.json());
    expect(body).toMatch(expected);
    expect(body).not.toMatch(/ANTHROPIC_API_KEY not configured/);
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe('the turn itself', () => {
  it('forwards the caller-supplied tool schemas and system prompt', async () => {
    const tools = [{ name: 'navigate', description: 'go', input_schema: { type: 'object' } }];
    await post({ messages, tools, system: 'You drive a browser.' });
    const params = streamMock.mock.calls[0][0];
    expect(params.tools).toEqual(tools);
    expect(params.system).toBe('You drive a browser.');
    expect(params.stream).toBe(true);
  });

  it('omits tools entirely when none are supplied', async () => {
    await post({ messages });
    expect(streamMock.mock.calls[0][0].tools).toBeUndefined();
  });
});
