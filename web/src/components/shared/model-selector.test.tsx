// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModelSelector } from './model-selector';
import { useProviderStore } from '@/stores/provider-store';

afterEach(() => {
  cleanup();
  useProviderStore.setState({ providers: [] });
});

describe('ModelSelector', () => {
  it('renders a trigger for the built-in value without a provider callback', () => {
    render(<ModelSelector value="sonnet" onChange={() => {}} />);
    // Radix Select items live in a portal that only mounts on open, so we only
    // assert the control mounts (the mapping logic is covered by unit tests).
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('mounts with onSelectModel + enabled provider models present (no crash)', () => {
    useProviderStore.setState({
      providers: [
        {
          id: 'openrouter-1',
          presetId: 'openrouter',
          label: 'OpenRouter',
          enabled: true,
          createdAt: 0,
          models: [{ id: 'moonshotai/kimi-k2', label: 'Kimi K2' }],
        },
      ],
    });
    const onSelectModel = vi.fn();
    render(
      <ModelSelector value="openrouter-1:moonshotai/kimi-k2" onChange={() => {}} onSelectModel={onSelectModel} />,
    );
    expect(screen.getByRole('combobox')).toBeTruthy();
  });
});
