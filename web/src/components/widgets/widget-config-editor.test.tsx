// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { WidgetTile } from './widget-tile';
import { WidgetConfigEditor } from './widget-config-editor';
import { useWidgetStore } from '@/stores/widget-store';
import { useRunStore } from '@/stores/run-store';
import type { Widget } from '@/lib/widgets/widget';

/**
 * TAILORING A DETERMINISTIC WIDGET.
 *
 * `widget-config.ts` has said since it was written that the defaults are only
 * defaults and "the edit UI exists for when it is wrong". There was no edit UI,
 * and the tile called `resolveWidgetPresetConfig(null)` with a hardcoded literal
 * — so stored config could never be read and nothing could write it. The
 * defaults were not defaults; they were the only reachable values.
 *
 * Asked as "How can I tailor widgets? weather seems to just be showing weather
 * for wherever it decides to show weather." Both halves of that are one bug.
 */

const widget = (over: Partial<Widget> = {}): Widget => ({
  id: 'w1',
  title: 'Weather',
  recipe: 'Current conditions where you are',
  refreshKind: 'weather',
  render: { type: 'statGrid', items: [{ label: 'Now', value: '15°C' }] },
  enabled: true,
  createdAt: 0,
  refreshedAt: Date.now() - 60_000,
  ...over,
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useWidgetStore.setState({ widgets: [] });
  useRunStore.setState({ goals: [], runs: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the tile reads its own config', () => {
  it('passes widget.config to the fetcher, not a hardcoded null', async () => {
    /*
     * The defect in one assertion. With `resolveWidgetPresetConfig(null)` the
     * URL carried the time-zone default no matter what the widget stored, so
     * four weather tiles could only ever show one place.
     */
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 18, weather_code: 0, wind_speed_10m: 5 } }),
    });
    render(
      <WidgetTile
        widget={widget({
          id: 'cfg-1',
          render: null,
          refreshedAt: undefined,
          config: { weather: { label: 'Lisbon', latitude: 38.72, longitude: -9.14 } },
        })}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain('latitude=38.72');
  });

  it('offers the gear only on deterministic widgets', () => {
    // An agent widget's configuration IS its recipe — a different editor, and
    // offering this one would imply a location setting it does not have.
    render(<WidgetTile widget={widget({ id: 'gear-1' })} />);
    expect(screen.queryByLabelText(/configure what this shows/i)).toBeTruthy();

    cleanup();
    render(<WidgetTile widget={widget({ id: 'gear-2', refreshKind: undefined })} />);
    expect(screen.queryByLabelText(/configure what this shows/i)).toBeNull();
  });

  it('the gear opens the editor', () => {
    render(<WidgetTile widget={widget({ id: 'gear-3' })} />);
    fireEvent.click(screen.getByLabelText(/configure what this shows/i));
    expect(screen.getByLabelText(/search a city/i)).toBeTruthy();
  });
});

describe('the weather editor', () => {
  it('searches for a city and saves the coordinates it returns', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ name: 'Lisbon', latitude: 38.72, longitude: -9.14, country: 'Portugal' }],
      }),
    });
    const onSave = vi.fn();
    render(<WidgetConfigEditor widget={widget()} onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText(/search a city/i), { target: { value: 'Lisbon' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText(/Lisbon, Portugal/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Lisbon, Portugal/));
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith({
      weather: { label: 'Lisbon', latitude: 38.72, longitude: -9.14 },
    });
  });

  it('says so when nothing matched, rather than looking like a failure', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    render(<WidgetConfigEditor widget={widget()} onSave={vi.fn()} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText(/search a city/i), { target: { value: 'zzzz' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText(/no places matched/i)).toBeTruthy());
  });

  it('saves a PARTIAL — editing weather must not freeze your clocks', () => {
    /*
     * Writing the whole resolved object would pin `clocks` and `tickers` at
     * today's defaults for this widget forever, so a later improvement to them
     * would never reach it. `resolveWidgetPresetConfig` merges field by field
     * precisely so that partials work.
     */
    const onSave = vi.fn();
    render(<WidgetConfigEditor widget={widget()} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Save'));

    const saved = onSave.mock.calls[0][0];
    expect(Object.keys(saved)).toEqual(['weather']);
  });
});

describe('the ticker and clock editors', () => {
  it('parses symbols, with and without labels', () => {
    const onSave = vi.fn();
    render(
      <WidgetConfigEditor
        widget={widget({ refreshKind: 'tickers', title: 'Ticker' })}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/symbols/i), { target: { value: 'AAPL, BTC-USD=Bitcoin' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith({
      tickers: [
        { symbol: 'AAPL', label: 'AAPL' },
        { symbol: 'BTC-USD', label: 'Bitcoin' },
      ],
    });
  });

  it('does not mistake a Yahoo FX suffix for a label', () => {
    // `AUDUSD=X` is a symbol that contains `=`. Splitting naively would request
    // `AUDUSD` — a different instrument that also happens to resolve.
    const onSave = vi.fn();
    render(
      <WidgetConfigEditor
        widget={widget({ refreshKind: 'tickers' })}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/symbols/i), { target: { value: 'AUDUSD=X' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave.mock.calls[0][0].tickers).toEqual([{ symbol: 'AUDUSD=X', label: 'AUDUSD=X' }]);
  });

  it('parses time zones and labels them by city', () => {
    const onSave = vi.fn();
    render(
      <WidgetConfigEditor
        widget={widget({ refreshKind: 'clocks' })}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/time zones/i), {
      target: { value: 'Europe/Lisbon, America/New_York' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith({
      clocks: [
        { tz: 'Europe/Lisbon', label: 'Lisbon' },
        { tz: 'America/New_York', label: 'New York' },
      ],
    });
  });
});

describe('saving from the tile', () => {
  it('writes the config to the store and re-renders the tile with it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 18, weather_code: 0, wind_speed_10m: 5 } }),
    });
    const w = widget({ id: 'save-1' });
    useWidgetStore.setState({ widgets: [w] });
    render(<WidgetTile widget={w} />);

    fireEvent.click(screen.getByLabelText(/configure what this shows/i));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      const stored = useWidgetStore.getState().widgets[0];
      expect(stored.config?.weather).toBeTruthy();
    });
  });
});
