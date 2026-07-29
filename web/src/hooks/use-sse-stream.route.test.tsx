// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSSEStream } from './use-sse-stream';
import { resolveSendRoute, buildTierOptions, buildModelOptions } from '@/lib/models/client-options';
import type { ProviderWithModels } from '@/lib/models/effective-registry';

/**
 * The request-body contract for model routing, tested at the hook boundary.
 *
 * Only `fetch` is mocked — `useSSEStream` itself is the unit under test, so the
 * body it builds is asserted for real. This is the deterministic counterpart to
 * `e2e/model-route.spec.ts` (disabled; see the note there): it covers
 * selection → resolved route → request body, which is where the live regression
 * was. A tier option carries no `.model`, so a caller reading `modelRoute?.model`
 * silently sent the built-in enum and dropped the tier with no error.
 */

const PROVIDERS: ProviderWithModels[] = [
  {
    id: 'or-1',
    presetId: 'openrouter',
    label: 'OpenRouter',
    enabled: true,
    createdAt: 0,
    models: [
      { id: 'moonshotai/kimi-k2', label: 'Kimi K2', pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 } },
    ],
  },
];
const KIMI_ID = 'or-1:moonshotai/kimi-k2';

const fetchMock = vi.fn();

/** An SSE response the hook's reader can drain to completion. */
function sseResponse() {
  const body = `data: ${JSON.stringify({ type: 'done' })}\n\n`;
  return new Response(new TextEncoder().encode(body), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(sseResponse());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The body the hook POSTed to /api/chat. */
function sentBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as RequestInit).body as string);
}

function harness() {
  return renderHook(() =>
    useSSEStream({
      chatId: 'c1',
      setIsStreaming: () => {},
      onChunk: () => {},
      onDone: () => {},
      onError: () => {},
    }),
  );
}

/** Mirrors exactly what a surface does at send time. */
async function sendWith(selectionId: string | null, builtinModel = 'sonnet') {
  const options = buildModelOptions(
    [{ id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }],
    PROVIDERS,
    { tierModels: { smort: KIMI_ID }, includeModelIds: selectionId ? [selectionId] : [] },
  );
  const selection = selectionId ? options.find((o) => o.id === selectionId) ?? null : null;
  const route = resolveSendRoute(selection, PROVIDERS, {
    capability: 'chat',
    tierModels: { smort: KIMI_ID },
    hasAnthropicKey: true,
  });

  const { result } = harness();
  await result.current.sendMessage('hi', 'c1', 'chat', route?.model ?? builtinModel, {
    apiKey: 'sk-test',
    providerConfig: route?.providerConfig,
  });
}

describe('request body — model routing', () => {
  it('a tier selection sends the RESOLVED user-provider model, not the built-in', async () => {
    await sendWith('tier:smort');
    const body = sentBody();
    // smort is assigned to the OpenRouter model, so that must be sent. 'opus'
    // here would mean the tier was dropped — the exact regression this guards.
    expect(body.model).toBe('moonshotai/kimi-k2');
    expect(body.providerConfig).toEqual({
      providerId: 'or-1',
      // Kimi is not an `anthropic/*` model, so it must reach OpenRouter through
      // the openai-compat shim; the Anthropic-format endpoint rejects it.
      transport: 'openai-compat',
      baseUrl: 'https://openrouter.ai/api/v1',
      // P1.6: distinguishes an env-driven provider from a key + base URL one.
      agentMode: 'api-key',
    });
  });

  it('a tier with no user assignment resolves to the built-in and sends no providerConfig', async () => {
    await sendWith('tier:good');
    const body = sentBody();
    expect(body.model).toBe('sonnet');
    expect(body.providerConfig).toBeUndefined();
  });

  it('no selection falls back to the surface built-in', async () => {
    await sendWith(null, 'sonnet');
    const body = sentBody();
    expect(body.model).toBe('sonnet');
    expect(body.providerConfig).toBeUndefined();
  });

  it('a pinned built-in overrides any tier assignment', async () => {
    await sendWith('opus');
    const body = sentBody();
    expect(body.model).toBe('opus');
    expect(body.providerConfig).toBeUndefined();
  });

  it('a pinned provider model sends its own providerConfig', async () => {
    await sendWith(KIMI_ID);
    const body = sentBody();
    expect(body.model).toBe('moonshotai/kimi-k2');
    expect((body.providerConfig as { providerId: string }).providerId).toBe('or-1');
  });

  it('omits providerConfig entirely rather than sending null', async () => {
    await sendWith('tier:good');
    expect('providerConfig' in sentBody()).toBe(false);
  });

  it('every tier route resolves to something sendable', async () => {
    for (const tier of buildTierOptions()) {
      const route = resolveSendRoute(tier, PROVIDERS, {
        capability: 'chat',
        tierModels: { smort: KIMI_ID },
        hasAnthropicKey: true,
      });
      // chat has no stallion tier, so that one tumbles — but must still resolve.
      expect(route?.model, `tier ${tier.tier} did not resolve`).toBeTruthy();
    }
  });
});
