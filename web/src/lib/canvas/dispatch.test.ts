import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchCanvasToolCall, refreshCanvasDoc } from './dispatch';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import { resetServerCredentials } from '@/hooks/use-builtin-access';

/**
 * Canvas writebacks and refreshes run as subagents. They must follow the
 * user's route: `/api/subagent` without `model` + `providerConfig` resolves
 * against the built-in Anthropic registry, which for an OpenRouter-only user
 * is a canvas whose buttons can never work. And they must not carry the
 * Anthropic key — the server reads it from its credential store.
 */

const openrouter = {
  id: 'p-openrouter',
  presetId: 'openrouter',
  label: 'OpenRouter',
  enabled: true,
  createdAt: 0,
  transport: 'openai-compat',
  baseUrl: 'https://openrouter.ai/api/v1',
  models: [
    {
      id: 'vendor/model-0',
      label: 'Model 0',
      capabilities: ['chat', 'code'],
      contextWindow: 200_000,
      pricing: { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
    },
  ],
};

const fetchMock = vi.fn();
const subagentBodies = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]) === '/api/subagent')
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);

function serverAnswers(body: { anthropic: boolean; bedrock: boolean }) {
  fetchMock.mockImplementation(async (url: string) =>
    url === '/api/models'
      ? Response.json(body)
      : Response.json({ text: 'done', canvas: { version: '1', root: [] } }),
  );
}

beforeEach(() => {
  resetServerCredentials();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useSettingsStore.setState({ anthropicApiKey: null, tierModels: {} });
  useProviderStore.setState({ providers: [openrouter] as never });
});

afterEach(() => vi.unstubAllGlobals());

const action = { type: 'tool-call' as const, componentId: 'c1', tool: 'mcp__x__do', args: { a: 1 } };

describe('canvas subagent calls follow the user’s route', () => {
  it('an OpenRouter-only user’s writeback is sent to their provider', async () => {
    serverAnswers({ anthropic: false, bedrock: false });
    await dispatchCanvasToolCall(action, { surfaceId: 'chat' });
    const [body] = subagentBodies();
    expect(body.model).toBe('vendor/model-0');
    expect((body.providerConfig as { providerId: string }).providerId).toBe('p-openrouter');
  });

  it('a refresh is routed the same way', async () => {
    serverAnswers({ anthropic: false, bedrock: false });
    await refreshCanvasDoc('rebuild the board', { surfaceId: 'cowork' });
    const [body] = subagentBodies();
    expect(body.model).toBe('vendor/model-0');
    expect(body.providerConfig).toBeTruthy();
  });

  it('leaves the built-in default to the server when Anthropic is reachable', async () => {
    serverAnswers({ anthropic: true, bedrock: false });
    await dispatchCanvasToolCall(action, { surfaceId: 'chat' });
    const [body] = subagentBodies();
    expect(body.model).toBeNull();
    expect(body.providerConfig).toBeNull();
  });

  it('never sends the Anthropic key, even when a stale caller still passes one', async () => {
    serverAnswers({ anthropic: true, bedrock: false });
    // Not a literal, so the (removed) `apiKey` option still reaches the call —
    // the shape an old caller would produce at runtime.
    const stale = { surfaceId: 'chat', apiKey: 'sk-ant-secret' };
    await dispatchCanvasToolCall(action, stale);
    await refreshCanvasDoc('again', stale);
    for (const body of subagentBodies()) expect(body).not.toHaveProperty('apiKey');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('sk-ant-secret');
  });
});
