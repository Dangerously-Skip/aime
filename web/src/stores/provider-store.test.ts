import { describe, it, expect, beforeEach } from 'vitest';
import { useProviderStore } from './provider-store';

beforeEach(() => {
  useProviderStore.setState({ providers: [] });
});

const store = () => useProviderStore.getState();

const cfg = (id: string, overrides = {}) => ({
  id,
  presetId: id,
  label: id,
  ...overrides,
});

describe('provider store', () => {
  it('adds a provider with sane defaults', () => {
    store().addProvider(cfg('openai'));
    const p = store().getProvider('openai')!;
    expect(p.enabled).toBe(true);
    expect(p.models).toEqual([]);
    expect(p.createdAt).toBeGreaterThan(0);
  });

  it('upserts by id instead of duplicating', () => {
    store().addProvider(cfg('openai', { label: 'OpenAI' }));
    store().addProvider(cfg('openai', { label: 'OpenAI (edited)', baseUrl: 'https://x/v1' }));
    expect(store().providers).toHaveLength(1);
    expect(store().getProvider('openai')?.label).toBe('OpenAI (edited)');
    expect(store().getProvider('openai')?.baseUrl).toBe('https://x/v1');
  });

  it('updates, toggles, and removes', () => {
    store().addProvider(cfg('groq'));
    store().updateProvider('groq', { baseUrl: 'https://api.groq.com/openai/v1' });
    expect(store().getProvider('groq')?.baseUrl).toContain('groq');

    store().setEnabled('groq', false);
    expect(store().getProvider('groq')?.enabled).toBe(false);

    store().removeProvider('groq');
    expect(store().getProvider('groq')).toBeUndefined();
  });

  it('stores scanned models and the credential hint', () => {
    store().addProvider(cfg('openrouter'));
    store().setModels('openrouter', [
      { id: 'moonshotai/kimi-k2', label: 'Kimi K2', capabilities: ['chat', 'code'] },
    ]);
    store().setHasCredentials('openrouter', true);

    const p = store().getProvider('openrouter')!;
    expect(p.models).toHaveLength(1);
    expect(p.hasCredentials).toBe(true);
  });

  it('getEnabledModels flattens enabled providers only, tagged by provider', () => {
    store().addProvider(cfg('openai'));
    store().addProvider(cfg('groq'));
    store().setModels('openai', [{ id: 'gpt-5', label: 'gpt-5' }]);
    store().setModels('groq', [{ id: 'llama', label: 'llama' }]);
    store().setEnabled('groq', false);

    const enabled = store().getEnabledModels();
    expect(enabled).toEqual([{ id: 'gpt-5', label: 'gpt-5', providerId: 'openai' }]);
  });
});
