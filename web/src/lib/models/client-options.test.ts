import { describe, it, expect } from 'vitest';
import { buildModelOptions, findOption, groupOptions, BUILTIN_GROUP, type ConfiguredProviderLite } from './client-options';

const BUILTINS = [
  { id: 'opus', label: 'Opus 4.7' },
  { id: 'sonnet', label: 'Sonnet 4.6' },
];

const openrouter: ConfiguredProviderLite = {
  id: 'openrouter-1',
  presetId: 'openrouter',
  label: 'OpenRouter',
  enabled: true,
  models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }],
};

const localOllama: ConfiguredProviderLite = {
  id: 'local-1',
  presetId: 'local',
  label: 'Local (Ollama)',
  baseUrl: 'http://127.0.0.1:11434/v1',
  enabled: true,
  models: [{ id: 'llama3' }],
};

describe('buildModelOptions', () => {
  it('lists built-ins first with their driver model and no providerConfig', () => {
    const opts = buildModelOptions(BUILTINS, []);
    expect(opts).toHaveLength(2);
    expect(opts[0]).toEqual({ id: 'opus', label: 'Opus 4.7', group: BUILTIN_GROUP, model: 'opus' });
    expect(opts[0].providerConfig).toBeUndefined();
  });

  it('adds enabled provider models tagged with a resolved providerConfig', () => {
    const opts = buildModelOptions(BUILTINS, [openrouter]);
    const kimi = opts.find((o) => o.id === 'openrouter-1:moonshotai/kimi-k2')!;
    expect(kimi.label).toBe('Kimi K2');
    expect(kimi.group).toBe('OpenRouter');
    expect(kimi.model).toBe('moonshotai/kimi-k2');
    // openrouter preset → anthropic-native transport, preset default base URL
    expect(kimi.providerConfig).toEqual({
      providerId: 'openrouter-1',
      transport: 'anthropic-native',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('prefers a provider base-URL override and derives openai-compat transport for local', () => {
    const opts = buildModelOptions(BUILTINS, [localOllama]);
    const llama = opts.find((o) => o.id === 'local-1:llama3')!;
    expect(llama.label).toBe('llama3'); // falls back to id when no label
    expect(llama.providerConfig).toEqual({
      providerId: 'local-1',
      transport: 'openai-compat',
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
  });

  it('skips disabled providers', () => {
    const opts = buildModelOptions(BUILTINS, [{ ...openrouter, enabled: false }]);
    expect(opts.every((o) => o.group === BUILTIN_GROUP)).toBe(true);
  });
});

describe('findOption / groupOptions', () => {
  it('finds an option by its select value', () => {
    const opts = buildModelOptions(BUILTINS, [openrouter]);
    expect(findOption(opts, 'sonnet')!.model).toBe('sonnet');
    expect(findOption(opts, 'nope')).toBeUndefined();
  });

  it('groups options by heading in insertion order', () => {
    const groups = groupOptions(buildModelOptions(BUILTINS, [openrouter, localOllama]));
    expect(groups.map((g) => g.group)).toEqual([BUILTIN_GROUP, 'OpenRouter', 'Local (Ollama)']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });
});
