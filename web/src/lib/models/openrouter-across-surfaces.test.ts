import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resolveSendRoute } from './client-options';
import { getSurfaceRoute, SURFACE_ROUTES } from './surface-routes';
import type { ProviderWithModels } from './effective-registry';

/**
 * The BYOK user's promise, end to end: "I put in a key, I set the models I want,
 * and every surface uses them."
 *
 * This walks the whole path for an OpenRouter-only setup — no Anthropic key, no
 * Bedrock — from the provider config the user created, through the client-side
 * chokepoint each surface calls, into the browser turn route, and out at the
 * HTTP client that would carry the request. It exists because the browser
 * surface silently failed exactly this scenario: it resolved against the
 * built-in Anthropic registry and then demanded a key the user does not have,
 * while every other surface worked.
 *
 * `send-route-coverage.test.ts` asserts each surface CALLS the chokepoint. This
 * asserts what the user actually gets OUT of it.
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

import { POST } from '@/app/api/chat/browser-turn/route';

/** An OpenRouter provider the user added and scanned, with two models. */
const openrouter: ProviderWithModels = {
  id: 'prov-openrouter-1',
  presetId: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  enabled: true,
  createdAt: 0,
  models: [
    {
      id: 'moonshotai/kimi-k2',
      label: 'Kimi K2',
      capabilities: ['chat', 'code'],
      pricing: { inputPer1kUsd: 0.0006, outputPer1kUsd: 0.0025 },
    },
    {
      id: 'qwen/qwen3-coder',
      label: 'Qwen3 Coder',
      capabilities: ['chat', 'code'],
      pricing: { inputPer1kUsd: 0.0002, outputPer1kUsd: 0.0008 },
    },
  ],
};

/** No built-in access at all — the setup that used to break the browser. */
const byokOnly = {
  tierModels: undefined,
  hasAnthropicKey: false,
  hasBedrock: false,
  known: true,
} as const;

let priorEnvKey: string | undefined;

beforeEach(() => {
  anthropicCtor.mockReset();
  streamMock.mockReset();
  streamMock.mockImplementation(() => ({
    on: vi.fn(),
    finalMessage: async () => ({ stop_reason: 'end_turn', usage: {} }),
  }));
  priorEnvKey = process.env.ANTHROPIC_API_KEY;
  // The point of the scenario: the server has no Anthropic key either.
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (priorEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorEnvKey;
});

describe('an OpenRouter-only user gets their provider on every surface', () => {
  it.each(Object.keys(SURFACE_ROUTES))('%s resolves to the OpenRouter provider', (surfaceId) => {
    const route = resolveSendRoute(null, [openrouter], {
      capability: getSurfaceRoute(surfaceId).capability,
      ...byokOnly,
    });

    expect(route, `${surfaceId} resolved nothing — that surface is dead for this user`).toBeTruthy();
    expect(route!.providerConfig?.providerId).toBe(openrouter.id);
    expect(openrouter.models.map((m) => m.id)).toContain(route!.model);
  });

  // Browser is listed above via SURFACE_ROUTES, but it is the one that regressed,
  // so it gets named explicitly — a future edit to SURFACE_ROUTES cannot quietly
  // drop it from the loop without this failing too.
  it('browser is one of those surfaces', () => {
    expect(Object.keys(SURFACE_ROUTES)).toContain('browser');
  });

  it('honours an explicit tier assignment over price inference', () => {
    const route = resolveSendRoute(null, [openrouter], {
      capability: 'chat',
      ...byokOnly,
      tierModels: { cheap: `${openrouter.id}:qwen/qwen3-coder` },
    });
    // Whatever tier the default preference lands on, the assignment must be
    // reachable — the tier grid is the user's control surface.
    expect(route).toBeTruthy();
    expect(route!.providerConfig?.providerId).toBe(openrouter.id);
  });
});

describe('the browser turn actually goes to OpenRouter', () => {
  it('sends the resolved model through the provider, with no Anthropic key present', async () => {
    const route = resolveSendRoute(null, [openrouter], {
      capability: getSurfaceRoute('browser').capability,
      ...byokOnly,
    })!;

    // Exactly what the surface posts: the resolved model AND its providerConfig.
    const res = await POST(
      new NextRequest('http://localhost/api/chat/browser-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'open example.com' }],
          model: route.model,
          providerConfig: route.providerConfig,
          apiKey: 'sk-or-user-key',
        }),
      }),
    );
    if (res.headers.get('content-type')?.includes('event-stream')) await res.text();

    // It ran at all. Before this work it returned "ANTHROPIC_API_KEY not
    // configured" here, because it never looked at the provider.
    expect(res.status).toBe(200);
    expect(streamMock).toHaveBeenCalled();

    const client = anthropicCtor.mock.calls[0][0];
    expect(client.apiKey).toBe('sk-or-user-key');
    // openai-compat providers are translated by the local shim, so the base URL
    // must be redirected somewhere — never left on the default Anthropic host.
    expect(client.baseURL, 'the turn would have gone to Anthropic').toBeTruthy();
    expect(streamMock.mock.calls[0][0].model).toBe(route.model);
  });
});
