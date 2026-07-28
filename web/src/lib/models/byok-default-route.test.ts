import { describe, it, expect } from 'vitest';
import { resolveSendRoute } from './client-options';
import type { ProviderWithModels } from './effective-registry';

/**
 * A user whose only credential is an OpenRouter key must be able to send a
 * message without ever touching Anthropic.
 *
 * Every surface defaults its model to the built-in id 'sonnet' and calls
 * resolveSendRoute with no pinned selection. That used to return null, so the
 * surface fell back to 'sonnet' with NO providerConfig — the built-in Anthropic
 * path. With no Anthropic key the Agent SDK then asked the user to log in, which
 * defeats the entire point of bringing an OpenRouter key.
 */

const openrouter = (n = 3): ProviderWithModels[] => [
  {
    id: 'p-openrouter',
    presetId: 'openrouter',
    label: 'OpenRouter',
    enabled: true,
    models: Array.from({ length: n }, (_, i) => ({
      id: `vendor/model-${i}`,
      label: `Model ${i}`,
      capabilities: ['chat', 'code'],
      contextWindow: 200_000,
      // Mid-range pricing so tier inference lands somewhere ordinary.
      pricing: { inputPer1kUsd: 0.003, outputPer1kUsd: 0.015 },
    })),
  } as unknown as ProviderWithModels,
];

describe('resolveSendRoute — BYOK with no Anthropic credential', () => {
  it('routes an unpinned send to the configured provider instead of a built-in', () => {
    const route = resolveSendRoute(null, openrouter(), {
      capability: 'chat',
      hasAnthropicKey: false,
    });

    expect(route).not.toBeNull();
    // The decisive part: a providerConfig must be present, or the request goes
    // down the built-in Anthropic path and prompts for a login.
    expect(route!.providerConfig).toBeTruthy();
    expect(route!.providerConfig!.providerId).toBe('p-openrouter');
    expect(route!.model).toMatch(/^vendor\/model-/);
  });

  it('still defers to the surface built-in when an Anthropic key exists', () => {
    // Not a regression: with a real Anthropic key, 'sonnet' is the right default
    // and the caller's own fallback should win.
    expect(
      resolveSendRoute(null, openrouter(), { capability: 'chat', hasAnthropicKey: true }),
    ).toBeNull();
  });

  it('defers when Bedrock is configured', () => {
    expect(
      resolveSendRoute(null, openrouter(), {
        capability: 'chat',
        hasAnthropicKey: false,
        hasBedrock: true,
      }),
    ).toBeNull();
  });

  it('returns null with no usable provider, so the caller keeps its own fallback', () => {
    expect(resolveSendRoute(null, [], { capability: 'chat', hasAnthropicKey: false })).toBeNull();
  });

  it('ignores a disabled provider and one with no models', () => {
    const disabled = openrouter();
    (disabled[0] as { enabled: boolean }).enabled = false;
    expect(
      resolveSendRoute(null, disabled, { capability: 'chat', hasAnthropicKey: false }),
    ).toBeNull();

    const empty = openrouter(0);
    expect(
      resolveSendRoute(null, empty, { capability: 'chat', hasAnthropicKey: false }),
    ).toBeNull();
  });

  it('does not disturb an explicit pin', () => {
    const route = resolveSendRoute(
      {
        id: 'p-openrouter:vendor/model-1',
        label: 'Model 1',
        group: 'OpenRouter',
        kind: 'model',
        model: 'vendor/model-1',
        providerConfig: { providerId: 'p-openrouter', transport: 'anthropic-native' },
      },
      openrouter(),
      { capability: 'chat', hasAnthropicKey: false },
    );
    expect(route?.model).toBe('vendor/model-1');
    expect(route?.providerConfig?.providerId).toBe('p-openrouter');
  });
});
