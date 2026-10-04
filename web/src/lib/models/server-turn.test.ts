import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const store = vi.hoisted(() => ({
  fields: {} as Record<string, Record<string, string>>,
}));

/**
 * The credential store is the OS-keyed encrypted file; its own suite covers it.
 * Stubbed here at the same interface so these tests are about what the route
 * helper DOES with a stored key, not about AES.
 */
vi.mock('./credentials', () => ({
  getCredentialStore: () => ({
    get: async (id: string) => store.fields[id],
    getField: async (id: string, field: string) => store.fields[id]?.[field],
  }),
  getServerAnthropicKey: async () =>
    process.env.ANTHROPIC_API_KEY ? undefined : store.fields.anthropic?.apiKey,
}));

import { resolveBuiltinSurfaceModel, resolveTurnExecution } from './server-turn';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_VERTEX',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'AWS_BEARER_TOKEN_BEDROCK',
];

beforeEach(() => {
  store.fields = {};
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
});
afterEach(() => vi.unstubAllEnvs());

const origin = 'http://127.0.0.1:3100';

describe('resolveTurnExecution', () => {
  it('is unusable with nothing configured', async () => {
    const { usable } = await resolveTurnExecution({ shimOrigin: origin });
    expect(usable).toBe(false);
  });

  it('uses the Settings key from the store when the request carries none', async () => {
    store.fields.anthropic = { apiKey: 'sk-stored' };
    const { exec, usable } = await resolveTurnExecution({ shimOrigin: origin });
    expect(usable).toBe(true);
    expect(exec.apiKey).toBe('sk-stored');
  });

  it('prefers the request key', async () => {
    store.fields.anthropic = { apiKey: 'sk-stored' };
    const { exec } = await resolveTurnExecution({ requestApiKey: 'sk-request', shimOrigin: origin });
    expect(exec.apiKey).toBe('sk-request');
  });

  it('never hands the Anthropic key to a user-added provider', async () => {
    store.fields.anthropic = { apiKey: 'sk-stored' };
    const { exec, usable } = await resolveTurnExecution({
      providerConfig: { providerId: 'or', transport: 'anthropic-native' },
      shimOrigin: origin,
    });
    expect(exec.apiKey).toBeUndefined();
    expect(usable).toBe(false);
  });

  it('refuses the Anthropic key when the REQUEST carries it to a user-added provider', async () => {
    // Regression: Chat and Cowork send the Settings key with every turn, and a
    // request key beat the provider's own — so an OpenRouter turn went out
    // authenticated with the Anthropic key.
    store.fields.anthropic = { apiKey: 'sk-ant-stored' };
    store.fields.or = { apiKey: 'sk-or' };
    const providerConfig = { providerId: 'or', transport: 'openai-compat' as const, baseUrl: 'https://openrouter.ai/api/v1' };

    const stored = await resolveTurnExecution({ providerConfig, requestApiKey: 'sk-ant-stored', shimOrigin: origin });
    expect(stored.exec.apiKey).toBe('sk-or');

    store.fields.anthropic = {};
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-env');
    const env = await resolveTurnExecution({ providerConfig, requestApiKey: 'sk-ant-env', shimOrigin: origin });
    expect(env.exec.apiKey).toBe('sk-or');

    // With no key of its own the provider goes keyless (a local server needs
    // none, so that still counts as usable) — never served the Anthropic one.
    delete store.fields.or;
    const none = await resolveTurnExecution({ providerConfig, requestApiKey: 'sk-ant-env', shimOrigin: origin });
    expect(none.exec.apiKey).toBeUndefined();
  });

  it('still honours a transient key meant for the provider', async () => {
    store.fields.anthropic = { apiKey: 'sk-ant-stored' };
    const { exec } = await resolveTurnExecution({
      providerConfig: { providerId: 'or', transport: 'anthropic-native', baseUrl: 'https://openrouter.ai/api' },
      requestApiKey: 'sk-or-transient',
      shimOrigin: origin,
    });
    expect(exec.apiKey).toBe('sk-or-transient');
  });

  it('reads a user-added provider’s own key and routes openai-compat through the shim', async () => {
    store.fields.or = { apiKey: 'sk-or' };
    const { exec, usable } = await resolveTurnExecution({
      providerConfig: { providerId: 'or', transport: 'openai-compat', baseUrl: 'https://openrouter.ai/api/v1' },
      shimOrigin: origin,
    });
    expect(usable).toBe(true);
    expect(exec.apiKey).toBe('sk-or');
    expect(exec.baseUrl).toContain(`${origin}/api/llm-proxy/or/`);
  });
});

describe('resolveBuiltinSurfaceModel', () => {
  it('resolves the surface’s intent against what is reachable', () => {
    expect(resolveBuiltinSurfaceModel({ surfaceId: 'cowork', hasAnthropicKey: true })?.model).toBe('opus');
    expect(resolveBuiltinSurfaceModel({ surfaceId: 'chat', hasAnthropicKey: true })?.model).toBe('sonnet');
  });

  it('honours a tier override', () => {
    expect(
      resolveBuiltinSurfaceModel({ surfaceId: 'cowork', tier: 'cheap', hasAnthropicKey: true })?.model,
    ).toBe('haiku');
  });

  it('resolves nothing when no built-in provider is reachable', () => {
    expect(resolveBuiltinSurfaceModel({ surfaceId: 'chat', hasAnthropicKey: false })).toBeNull();
  });
});
