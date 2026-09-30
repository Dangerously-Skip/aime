import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const store = vi.hoisted(() => ({ fields: {} as Record<string, Record<string, string>> }));

// The store's own suite covers the encryption; this is about what the harness
// does with what it finds there.
vi.mock('@/lib/models/credentials', () => ({
  getCredentialStore: () => ({
    get: async (id: string) => store.fields[id],
    getField: async (id: string, field: string) => store.fields[id]?.[field],
  }),
  getServerAnthropicKey: async () =>
    process.env.ANTHROPIC_API_KEY ? undefined : store.fields.anthropic?.apiKey,
}));

import { resolveHarnessExecution } from './execution';

const origin = 'http://127.0.0.1:3100';
const openrouter = { providerId: 'or', transport: 'anthropic-native' as const, baseUrl: 'https://openrouter.ai/api' };

beforeEach(() => {
  store.fields = {};
  vi.stubEnv('ANTHROPIC_API_KEY', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('resolveHarnessExecution — the Anthropic key stays with Anthropic', () => {
  it('drops the Anthropic key a goal run carried for a user-added provider, and uses the provider’s own', async () => {
    store.fields.anthropic = { apiKey: 'sk-ant-stored' };
    store.fields.or = { apiKey: 'sk-or' };
    const exec = await resolveHarnessExecution(
      { model: 'moonshotai/kimi-k2', providerConfig: openrouter, apiKey: 'sk-ant-stored' },
      'sonnet',
      origin,
    );
    expect(exec.apiKey).toBe('sk-or');
  });

  it('keeps a transient key meant for the provider', async () => {
    store.fields.anthropic = { apiKey: 'sk-ant-stored' };
    const exec = await resolveHarnessExecution(
      { model: 'x', providerConfig: openrouter, apiKey: 'sk-or-transient' },
      'sonnet',
      origin,
    );
    expect(exec.apiKey).toBe('sk-or-transient');
  });
});
