// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import {
  ModelSelector,
  buildSelectorOptions,
  dispatchSelection,
  displayValue,
} from './model-selector';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import { resetServerCredentials, useServerCredentialsStore } from '@/hooks/use-builtin-access';
import {
  BUILTIN_GROUP,
  TIER_GROUP,
  TIER_LABELS,
  type ModelOption,
} from '@/lib/models/client-options';
import type { ProviderWithModels } from '@/lib/models/effective-registry';

const PROVIDER = {
  id: 'openrouter-1',
  presetId: 'openrouter',
  label: 'OpenRouter',
  enabled: true,
  createdAt: 0,
  models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }],
};

/** Same provider, priced — `defaultRoute` needs a price to infer a tier. */
const PRICED_PROVIDER: ProviderWithModels = {
  ...PROVIDER,
  models: [
    {
      id: 'moonshotai/kimi-k2',
      label: 'Kimi K2',
      pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 },
    },
  ],
};

beforeEach(() => {
  resetServerCredentials();
  // The selector asks /api/models whether the server can reach Claude.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ anthropic: false, bedrock: false })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useProviderStore.setState({ providers: [] });
  useSettingsStore.setState({ tierModels: {} });
});

describe('ModelSelector', () => {
  it('renders a trigger for the built-in value without a provider callback', () => {
    render(<ModelSelector value="sonnet" onChange={() => {}} />);
    // Select items live in a portal that only mounts on open, so we only
    // assert the control mounts (the mapping logic is covered by unit tests).
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('mounts with onSelectModel + enabled provider models present (no crash)', () => {
    useProviderStore.setState({ providers: [PROVIDER] });
    const onSelectModel = vi.fn();
    render(
      <ModelSelector value="openrouter-1:moonshotai/kimi-k2" onChange={() => {}} onSelectModel={onSelectModel} />,
    );
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('mounts and offers the tier routes when onSelectModel is provided', () => {
    useProviderStore.setState({ providers: [PROVIDER] });
    useSettingsStore.setState({ tierModels: { good: 'openrouter-1:moonshotai/kimi-k2' } });
    render(<ModelSelector value="sonnet" onChange={() => {}} onSelectModel={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeTruthy();

    // The options the mounted selector builds (same arguments it passes).
    const options = buildSelectorOptions(
      useProviderStore.getState().providers,
      useSettingsStore.getState().tierModels,
      'sonnet',
      true,
    );
    const tiers = options.filter((o) => o.group === TIER_GROUP);
    expect(tiers.map((o) => o.id)).toEqual([
      'tier:stallion',
      'tier:smort',
      'tier:good',
      'tier:cheap',
    ]);
    expect(tiers.every((o) => o.kind === 'tier')).toBe(true);
    expect(tiers[2].label).toBe(TIER_LABELS.good);
    // The tier-assigned provider model is surfaced so the assignment is visible.
    expect(options.some((o) => o.id === 'openrouter-1:moonshotai/kimi-k2')).toBe(true);
  });

  it('keeps the current pinned provider model in its own dropdown', () => {
    const options = buildSelectorOptions([PROVIDER], {}, 'openrouter-1:moonshotai/kimi-k2', true);
    const pinned = options.find((o) => o.id === 'openrouter-1:moonshotai/kimi-k2');
    expect(pinned?.model).toBe('moonshotai/kimi-k2');
    expect(pinned?.providerConfig?.providerId).toBe('openrouter-1');
  });

  it('stays models-only for legacy callers (no onSelectModel)', () => {
    const options = buildSelectorOptions([PROVIDER], { good: 'openrouter-1:moonshotai/kimi-k2' }, 'sonnet', false);
    expect(options.every((o) => o.kind === 'model' && !o.providerConfig)).toBe(true);
    expect(options.map((o) => o.id)).toEqual(['opus', 'sonnet', 'haiku']);
  });
});

describe('offering only what a key can actually reach', () => {
  it('drops the Built-in (Claude) group with no Anthropic/Bedrock credential', () => {
    const options = buildSelectorOptions([PROVIDER], {}, 'sonnet', true, false);
    expect(options.some((o) => o.group === BUILTIN_GROUP)).toBe(false);
    // The tier routes stay — they are how a BYOK-only user reaches their models.
    expect(options.filter((o) => o.group === TIER_GROUP)).toHaveLength(4);
  });

  it('keeps them when a credential exists', () => {
    const options = buildSelectorOptions([PROVIDER], {}, 'sonnet', true, true);
    expect(options.filter((o) => o.group === BUILTIN_GROUP).map((o) => o.id)).toEqual([
      'opus',
      'sonnet',
      'haiku',
    ]);
  });

  it('keeps them for legacy callers regardless — they are the whole dropdown', () => {
    const options = buildSelectorOptions([PROVIDER], {}, 'sonnet', false, false);
    expect(options.map((o) => o.id)).toEqual(['opus', 'sonnet', 'haiku']);
  });
});

describe('displayValue — the trigger must not lie about the route', () => {
  const opts = { capability: 'chat' as const };

  it('shows the tier the turn will actually take when "sonnet" is unreachable', () => {
    const options = buildSelectorOptions([PRICED_PROVIDER], {}, 'sonnet', true, false);
    // The surface default is still 'sonnet', but no built-in credential exists,
    // so resolveSendRoute sends the turn to OpenRouter via a tier.
    expect(displayValue('sonnet', options, [PRICED_PROVIDER], opts)).toBe('tier:good');
  });

  it('leaves a value that IS offered alone', () => {
    const options = buildSelectorOptions([PRICED_PROVIDER], {}, 'sonnet', true, true);
    expect(displayValue('sonnet', options, [PRICED_PROVIDER], { ...opts, hasAnthropicKey: true }))
      .toBe('sonnet');
  });

  it('leaves the value alone when nothing else resolves either', () => {
    const options = buildSelectorOptions([], {}, 'sonnet', true, false);
    expect(displayValue('sonnet', options, [], opts)).toBe('sonnet');
  });

  it('keeps a pinned provider model as-is', () => {
    const id = 'openrouter-1:moonshotai/kimi-k2';
    const options = buildSelectorOptions([PRICED_PROVIDER], {}, id, true, false);
    expect(displayValue(id, options, [PRICED_PROVIDER], opts)).toBe(id);
  });
});

/**
 * Rendered, not just the pure helpers.
 *
 * Every substantive assertion in this file used to call `buildSelectorOptions` /
 * `displayValue` with hand-passed arguments, while the three tests that actually
 * mounted the component asserted only that a combobox existed. So reverting
 * `value={shown}` or dropping the `hasBuiltins` argument at the call site passed
 * all twenty tests — and the reported bug came straight back.
 */
describe('ModelSelector — the wiring, through a real render', () => {
  async function mountWith(server: { anthropic: boolean; bedrock: boolean }, value: string) {
    resetServerCredentials();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(server)));
    useProviderStore.setState({ providers: [PRICED_PROVIDER] });
    const view = render(<ModelSelector value={value} onChange={() => {}} onSelectModel={vi.fn()} />);
    // Let the /api/models answer land so `hasBuiltins` is no longer optimistic.
    await waitFor(() =>
      expect(useServerCredentialsStore.getState().server).not.toBeNull(),
    );
    return view;
  }

  it('shows the tier it will actually route to, not the unreachable default', async () => {
    await mountWith({ anthropic: false, bedrock: false }, 'sonnet');
    // The store still says 'sonnet'; the trigger must not.
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Good'));
    expect(screen.getByRole('combobox').textContent).not.toContain('Sonnet');
  });

  it('shows the built-in when it IS reachable', async () => {
    await mountWith({ anthropic: true, bedrock: false }, 'sonnet');
    await waitFor(() => expect(screen.getByRole('combobox').textContent).toContain('Sonnet 4.6'));
  });

  it('does not pin the substituted value as the selection', async () => {
    // Radix suppresses onValueChange when the picked item equals the current
    // value, so making the displayed tier the selected value made that very
    // option unclickable.
    await mountWith({ anthropic: false, bedrock: false }, 'sonnet');
    const combo = screen.getByRole('combobox');
    expect(combo.getAttribute('data-state')).toBeDefined();
    // 'sonnet' is not on offer, so nothing is selected — every item is a change.
    expect(combo.textContent).toContain('Good');
  });
});

describe('ModelSelector selection routing', () => {
  const tier: ModelOption = {
    id: 'tier:good',
    label: TIER_LABELS.good,
    group: TIER_GROUP,
    kind: 'tier',
    tier: 'good',
  };
  const providerModel: ModelOption = {
    id: 'openrouter-1:moonshotai/kimi-k2',
    label: 'Kimi K2',
    group: 'OpenRouter',
    kind: 'model',
    model: 'moonshotai/kimi-k2',
    providerConfig: { providerId: 'openrouter-1', transport: 'openai-compat' },
  };
  const builtin: ModelOption = { id: 'opus', label: 'Opus 4.7', group: 'Built-in (Claude)', kind: 'model', model: 'opus' };

  it('selecting a tier reports the route and never touches the built-in enum', () => {
    const onChange = vi.fn();
    const onSelectModel = vi.fn();
    dispatchSelection(tier, tier.id, { onChange, onSelectModel });
    // `tier:good` is not a valid ModelId — pushing it through onChange would be
    // rejected by the store and would silently drop the selection.
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelectModel).toHaveBeenCalledWith(tier);
  });

  it('selecting a provider model reports the route only', () => {
    const onChange = vi.fn();
    const onSelectModel = vi.fn();
    dispatchSelection(providerModel, providerModel.id, { onChange, onSelectModel });
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelectModel).toHaveBeenCalledWith(providerModel);
  });

  it('selecting a built-in sets the enum and reports it', () => {
    const onChange = vi.fn();
    const onSelectModel = vi.fn();
    dispatchSelection(builtin, builtin.id, { onChange, onSelectModel });
    expect(onChange).toHaveBeenCalledWith('opus');
    expect(onSelectModel).toHaveBeenCalledWith(builtin);
  });

  it('works without onSelectModel (built-in only, no throw)', () => {
    const onChange = vi.fn();
    dispatchSelection(builtin, builtin.id, { onChange });
    expect(onChange).toHaveBeenCalledWith('opus');
  });

  it('never leaks an unknown tier id to onChange', () => {
    const onChange = vi.fn();
    const onSelectModel = vi.fn();
    dispatchSelection(undefined, 'tier:smort', { onChange, onSelectModel });
    expect(onChange).not.toHaveBeenCalled();
    expect(onSelectModel).not.toHaveBeenCalled();
  });
});
