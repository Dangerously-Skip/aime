// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TierGrid } from './tier-grid';
import { useProviderStore } from '@/stores/provider-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { ScannedModel } from '@/lib/models/providers';

/**
 * A realistic OpenRouter scan: ~345 models across a 20,000x price range. This is
 * the shape the picker must survive — the regression this suite guards is a
 * dropdown that enumerates all of them.
 */
function bigCatalog(count = 345): ScannedModel[] {
  return Array.from({ length: count }, (_, i) => {
    // 0.000001 → 0.2 output USD/1k, spanning every tier band.
    const out = 0.000001 * Math.pow(1.035, i);
    return {
      id: `vendor${i % 12}/model-${i}`,
      label: `Vendor${i % 12} Model ${i}`,
      pricing: { inputPer1kUsd: out / 3, outputPer1kUsd: out },
    };
  });
}

function seedProvider(models: ScannedModel[]) {
  useProviderStore.setState({
    providers: [
      {
        id: 'p1',
        presetId: 'openrouter',
        label: 'OpenRouter',
        enabled: true,
        createdAt: 0,
        models,
        hasCredentials: true,
      },
    ],
  });
}

beforeEach(() => {
  useProviderStore.setState({ providers: [] });
  useSettingsStore.setState({ tierModels: {}, surfaceTiers: {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useSettingsStore.setState({ tierModels: {}, surfaceTiers: {} });
});

describe('TierGrid', () => {
  it('renders a row for all four tiers, premium-first', () => {
    render(<TierGrid />);
    expect(screen.getByText('How AIME picks models')).toBeTruthy();

    const rows = screen.getAllByTestId('tier-row');
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => within(r).getByText(/^(Stallion|Smort|Good|Cheap)$/).textContent)).toEqual(
      ['Stallion', 'Smort', 'Good', 'Cheap'],
    );
  });

  it('pre-fills each slot from price inference, with the built-in preferred', () => {
    render(<TierGrid />);
    const rows = screen.getAllByTestId('tier-row');
    // opus 0.025 → smort, sonnet 0.015 → good, haiku 0.005 → cheap.
    expect(within(rows[1]).getByText('Opus 4.7')).toBeTruthy();
    expect(within(rows[1]).getByText('inferred')).toBeTruthy();
    expect(within(rows[1]).getByText('$0.0250/1k out')).toBeTruthy();
    expect(within(rows[2]).getByText('Sonnet 4.6')).toBeTruthy();
    expect(within(rows[3]).getByText('Haiku 4.5')).toBeTruthy();
    // No built-in reaches the stallion band and there are no providers yet.
    expect(within(rows[0]).getByText(/nothing inferred/i)).toBeTruthy();
  });

  it('does NOT render the whole 345-model catalog when the picker opens', () => {
    seedProvider(bigCatalog(345));
    render(<TierGrid />);

    fireEvent.click(screen.getAllByText('Change')[0]);

    const options = screen.getAllByTestId('tier-option');
    expect(options.length).toBeLessThanOrEqual(40);
    // 345 scanned + 3 built-ins, all matched by the empty query but not rendered.
    expect(screen.getByText('showing 30 of 348')).toBeTruthy();
  });

  it('filters candidates as you type', () => {
    seedProvider(bigCatalog(345));
    render(<TierGrid />);
    fireEvent.click(screen.getAllByText('Change')[0]);

    const search = screen.getByPlaceholderText('Search models…');
    fireEvent.change(search, { target: { value: 'Model 137' } });

    const options = screen.getAllByTestId('tier-option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Vendor5 Model 137');
    expect(screen.getByText('showing 1 of 1')).toBeTruthy();

    // A broader query matches more, still bounded by the visible cap.
    fireEvent.change(search, { target: { value: 'vendor3' } });
    expect(screen.getAllByTestId('tier-option').length).toBeLessThanOrEqual(30);
    expect(screen.getByText(/showing \d+ of 2[89]/)).toBeTruthy();

    // A miss renders nothing.
    fireEvent.change(search, { target: { value: 'no-such-model-zzz' } });
    expect(screen.queryAllByTestId('tier-option')).toHaveLength(0);
    expect(screen.getByText('No models match.')).toBeTruthy();
  });

  it('assigns a model to a tier and clears it back to inferred', () => {
    seedProvider(bigCatalog(345));
    render(<TierGrid />);

    // Row 0 is stallion (premium-first).
    fireEvent.click(screen.getAllByText('Change')[0]);
    fireEvent.change(screen.getByPlaceholderText('Search models…'), {
      target: { value: 'Model 137' },
    });
    fireEvent.click(screen.getByTestId('tier-option'));

    expect(useSettingsStore.getState().tierModels.stallion).toBe('p1:vendor5/model-137');
    // Picker closes on select and the assignment is shown on the row.
    expect(screen.queryByPlaceholderText('Search models…')).toBeNull();
    const stallionRow = screen.getAllByTestId('tier-row')[0];
    expect(within(stallionRow).getByText('Vendor5 Model 137')).toBeTruthy();
    expect(within(stallionRow).queryByText('inferred')).toBeNull();

    fireEvent.click(screen.getByTitle('Clear Stallion assignment'));
    expect('stallion' in useSettingsStore.getState().tierModels).toBe(false);
  });

  it('picks a built-in for a tier too', () => {
    render(<TierGrid />);
    // Row 3 is cheap.
    fireEvent.click(screen.getAllByText('Change')[3]);
    fireEvent.change(screen.getByPlaceholderText('Search models…'), { target: { value: 'opus' } });
    fireEvent.click(screen.getByTestId('tier-option'));

    expect(useSettingsStore.getState().tierModels.cheap).toBe('opus');
  });

  it('overrides a surface tier and reverts to inherit', () => {
    render(<TierGrid />);
    const select = screen.getByLabelText('Tier for cowork') as HTMLSelectElement;
    // cowork defaults to code/smort.
    expect(select.value).toBe('');
    expect(screen.getByText(/code · default smort/)).toBeTruthy();

    fireEvent.change(select, { target: { value: 'cheap' } });
    expect(useSettingsStore.getState().surfaceTiers.cowork).toBe('cheap');

    fireEvent.change(select, { target: { value: '' } });
    expect('cowork' in useSettingsStore.getState().surfaceTiers).toBe(false);
  });

  it('renders a tier control for every routed surface', () => {
    render(<TierGrid />);
    for (const surfaceId of ['chat', 'browser', 'assistant', 'cowork', 'code']) {
      expect(screen.getByLabelText(`Tier for ${surfaceId}`)).toBeTruthy();
    }
  });
});
