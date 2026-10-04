import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { QueryParams, StreamChunk } from '@/lib/providers/base-provider';

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  abortMock: vi.fn(),
  agents: [] as Array<{ name: string; description: string; model?: string }>,
}));

vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: mocks.queryMock, abort: mocks.abortMock }),
}));
vi.mock('@/lib/agents-parser', () => ({
  loadAgents: () => mocks.agents,
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
  mocks.agents = [];
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

  it('a named agent’s `model:` pin does not beat the route from Settings', async () => {
    // Regression: the pin won, so a BYOK user's agent sent a Claude id to
    // their OpenRouter provider.
    mocks.agents = [{ name: 'researcher', description: '', model: 'claude-opus-4-6' }];
    await post({
      task: 't',
      agentName: 'researcher',
      apiKey: 'sk-or',
      providerConfig: { providerId: 'or', transport: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1'},
      model: 'moonshotai/kimi-k2',
    });
    expect(params().model).toBe('moonshotai/kimi-k2');

    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env');
    await post({ task: 't', agentName: 'researcher', surfaceId: 'chat', tier: 'cheap' });
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

/*
 * Attended or not is the CALLER's statement, and absence is the safe side. The
 * `subagent_` prefix cannot tell a click from a follow-up the app fired by
 * itself, so nothing here may infer it. The enforcement behind each answer is
 * proved against the real provider in claude-provider.background-runs.test.ts.
 */
describe('POST /api/subagent — attended is stated, and defaults to unattended', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'sk-env'));

  it('absent ⇒ unattended: the consequential policy, and the named tools approve nothing', async () => {
    await post({ task: 't', extraAllowedTools: ['mcp__github__create_pull_request'] });
    expect(params().approvalPolicy).toBe('consequential');
    expect(params().userApprovedTools).toBeUndefined();
    // Still exposed — exposure is not approval.
    expect(params().allowedTools).toContain('mcp__github__create_pull_request');
  });

  it('attended: false is the same as absent', async () => {
    await post({ task: 't', attended: false, extraAllowedTools: ['mcp__github__create_pull_request'] });
    expect(params().approvalPolicy).toBe('consequential');
    expect(params().userApprovedTools).toBeUndefined();
  });

  it('attended: true ⇒ policy never, and the click approves exactly the tools it named', async () => {
    await post({ task: 't', attended: true, extraAllowedTools: ['mcp__github__create_pull_request'] });
    expect(params().approvalPolicy).toBe('never');
    expect(params().userApprovedTools).toEqual(['mcp__github__create_pull_request']);
  });

  it.each([['"true"', 'true'], ['1', 1], ['null', null], ['an array', [true]]])(
    'attended: %s is a 400, not a guess',
    async (_label, attended) => {
      const { status, json } = await post({ task: 't', attended });
      expect(status).toBe(400);
      expect(json.error).toMatch(/attended/);
      expect(mocks.queryMock).not.toHaveBeenCalled();
    },
  );

  it.each([['a string', 'Write'], ['an array with a non-string', ['Write', 3]]])(
    'extraAllowedTools as %s is a 400',
    async (_label, extraAllowedTools) => {
      const { status } = await post({ task: 't', attended: true, extraAllowedTools });
      expect(status).toBe(400);
      expect(mocks.queryMock).not.toHaveBeenCalled();
    },
  );

  it('reports the refusals the gate made, on success and on failure', async () => {
    mocks.queryMock.mockImplementation(async function* (p: QueryParams) {
      p.onToolRefused?.({ tool: 'Write', reason: 'Unattended run: has effects outside the app', at: 1 });
      yield { type: 'text', content: 'could not write' };
    });
    const ok = await post({ task: 't' });
    expect(ok.json.refused).toEqual([{ tool: 'Write', reason: 'Unattended run: has effects outside the app', at: 1 }]);

    mocks.queryMock.mockImplementation(async function* (p: QueryParams) {
      p.onToolRefused?.({ tool: 'Bash', reason: 'Turned off in Settings', at: 2 });
      yield { type: 'error', message: 'boom', code: 'unknown' };
    });
    const failed = await post({ task: 't' });
    expect(failed.status).toBe(502);
    expect(failed.json.refused).toEqual([{ tool: 'Bash', reason: 'Turned off in Settings', at: 2 }]);
  });
});
