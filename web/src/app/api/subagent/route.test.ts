import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { QueryParams, StreamChunk } from '@/lib/providers/base-provider';

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  abortMock: vi.fn(),
}));

vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: mocks.queryMock, abort: mocks.abortMock }),
}));
vi.mock('@/lib/agents-parser', () => ({
  loadAgents: () => [],
  readAgentSystemPrompt: () => '',
}));
vi.mock('@/lib/mcp/provisioned', () => ({ loadProvisionedMcpServers: async () => ({}) }));

import { POST } from './route';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_VERTEX',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK',
  // No credential store (it is keyed from this), so nothing leaks in from the machine.
  'AIME_CRED_KEY',
];

function script(chunks: Partial<StreamChunk>[]) {
  mocks.queryMock.mockImplementation(async function* () {
    for (const c of chunks) yield c;
  });
}

async function post(body: unknown, signal?: AbortSignal) {
  const res = await POST(
    new NextRequest('http://127.0.0.1:3100/api/subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const params = () => mocks.queryMock.mock.calls.at(-1)![0] as QueryParams;

beforeEach(() => {
  mocks.queryMock.mockReset();
  mocks.abortMock.mockReset();
  script([{ type: 'text', content: 'sub says hi' }]);
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/subagent — the model route', () => {
  it('runs on the user-added provider the client resolved, with its key and base URL', async () => {
    // Regression: it ran `surfaceConfig.model` with only the body's key, so an
    // OpenRouter-only user's subagent went to the built-in registry and died.
    const { status, json } = await post({
      task: 't',
      model: 'deepseek/deepseek-v4-pro',
      apiKey: 'sk-or',
      providerConfig: { providerId: 'or', transport: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1' },
    });

    expect(status).toBe(200);
    expect(json.output).toBe('sub says hi');
    expect(params()).toMatchObject({ model: 'deepseek/deepseek-v4-pro', apiKey: 'sk-or' });
    expect(params().baseUrl).toContain('/api/llm-proxy/or/');
  });

  it('resolves the surface’s built-in default through the registry when nothing is pinned', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env');
    await post({ task: 't', surfaceId: 'chat', tier: 'cheap' });
    expect(params().model).toBe('haiku');
  });

  it('refuses before starting anything when no model is configured', async () => {
    const { status, json } = await post({ task: 't' });
    expect(status).toBe(400);
    expect(json.code).toBe('no_model');
    expect(mocks.queryMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/subagent — outcomes', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env'));

  it('reports a typed turn failure as a failure, not as an empty success', async () => {
    script([{ type: 'error', message: 'Not logged in', code: 'auth' }, { type: 'done', error: true }]);
    const { status, json } = await post({ task: 't' });
    expect(status).toBe(502);
    expect(json).toMatchObject({ error: 'Not logged in', code: 'auth' });
  });

  it('classifies a thrown error', async () => {
    mocks.queryMock.mockImplementation(async function* () {
      throw Object.assign(new Error('Too Many Requests'), { status: 429 });
    });
    const { status, json } = await post({ task: 't' });
    expect(status).toBe(500);
    expect(json.code).toBe('rate_limit');
  });

  it('stops the run when the caller goes away', async () => {
    const controller = new AbortController();
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'working…' };
      controller.abort();
      await new Promise((r) => setTimeout(r, 0));
    });

    const { status } = await post({ task: 't', surfaceId: 'cowork', parentChatId: 'p1' }, controller.signal);

    expect(mocks.abortMock).toHaveBeenCalledTimes(1);
    const [chatId, surfaceId] = mocks.abortMock.mock.calls[0];
    expect(chatId).toBe(params().chatId);
    expect(chatId).toMatch(/^subagent_p1_/);
    expect(surfaceId).toBe('cowork');
    expect(status).toBe(499);
  });
});
