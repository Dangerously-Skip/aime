// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { WidgetGrid } from './widget-grid';
import { useWidgetStore } from '@/stores/widget-store';
import { useRunStore } from '@/stores/run-store';

/**
 * A PRESET IS ADDED WHERE PRESETS LIVE.
 *
 * Three rounds on one small thing, and each round the fix was narrower than the
 * bug:
 *
 *   1. Presets changed from cards to widgets, so clicking one on ACTIVITY
 *      created it in the COCKPIT. Nothing happened on screen. Reported as
 *      "dashboards aren't working".
 *   2. I made the Activity button navigate to the Cockpit — and there was a
 *      SECOND preset row thirty lines further down that I did not touch. The
 *      test I wrote scoped its "no inline addWidget" check to a 900-character
 *      window and never saw it. A guard that looks near where you were working
 *      only proves you did not reoffend in the same spot.
 *   3. Activity now had two ways to add a thing it could not display, which is
 *      why the two tabs read as "the same screen".
 *
 * The rule the codebase already documents settles it: Activity is EVENTS, the
 * Cockpit is STATE, and a widget is state. One row, on the Cockpit, beside the
 * grid it fills. There is no navigation to get wrong because there is nowhere
 * else to be.
 */

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWidgetStore.setState({ widgets: [] });
  useRunStore.setState({ goals: [], runs: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Cockpit quick-add row', () => {
  it('offers every preset', () => {
    render(<WidgetGrid />);
    for (const label of ['Weather', 'Stock ticker', 'World clock']) {
      expect(
        screen.getByRole('button', { name: new RegExp(label, 'i') }),
        `no quick-add button for ${label}`,
      ).toBeTruthy();
    }
  });

  it('clicking one creates a widget IN THE GRID THAT IS ON SCREEN', async () => {
    render(<WidgetGrid />);
    fireEvent.click(screen.getByRole('button', { name: /weather/i }));

    await waitFor(() => expect(useWidgetStore.getState().widgets).toHaveLength(1));
    // The half that was missing for two rounds: it is VISIBLE, not merely stored.
    expect(screen.getAllByText('Weather').length).toBeGreaterThan(1);
  });

  it('carries the preset through — a deterministic widget, not a bare recipe', async () => {
    render(<WidgetGrid />);
    fireEvent.click(screen.getByRole('button', { name: /stock ticker/i }));

    await waitFor(() => expect(useWidgetStore.getState().widgets).toHaveLength(1));
    const w = useWidgetStore.getState().widgets[0];
    // Without `refreshKind` it would go to a model on every schedule tick.
    expect(w.refreshKind).toBe('tickers');
    expect(w.refreshEverySeconds).toBeGreaterThan(0);
  });
});

describe('the Assistant feed does not add widgets', () => {
  /*
   * Derived from source over the WHOLE file rather than a window around the
   * edit, which is precisely what the previous version got wrong.
   */
  const surface = fs.readFileSync(
    path.join(process.cwd(), 'src/components/surfaces/assistant/assistant-surface.tsx'),
    'utf8',
  );

  it('has no preset row left on Activity', () => {
    expect(surface).not.toContain('WIDGET_PRESETS');
    expect(surface).not.toContain('buildPresetWidget');
  });

  it('cannot create a widget at all — anywhere in the file', () => {
    // The events feed has no business minting state, and a call site here is
    // how a widget lands somewhere nothing renders it.
    expect(surface).not.toMatch(/addWidget\s*\(/);
  });
});
