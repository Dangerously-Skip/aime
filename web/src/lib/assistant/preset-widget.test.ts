import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WIDGET_PRESETS, buildPresetWidget, refreshByKind } from './widget-presets';

/**
 * A PRESET IS JUST A WIDGET NOW.
 *
 * It used to build an `AssistantCard` with a `widget:` block bolted on, so a
 * stock ticker — STATE, one current value replaced on refresh — lived in the
 * event feed beside things that had happened. It could not be edited,
 * rescheduled or asked about, and none of the unread / digest / quiet-hours
 * work applied, because all of that was built for the other widget system.
 *
 * The split was on AUTHORSHIP: shipped things got a fetcher and a card, user
 * things got an agent and a tile. The real axes are independent — event vs
 * state, and deterministic vs agent — and this collapses the first while
 * keeping the second.
 */

describe('presets build widgets', () => {
  it.each(WIDGET_PRESETS.map((p) => p.kind))('%s becomes a widget', (kind) => {
    const preset = WIDGET_PRESETS.find((p) => p.kind === kind)!;
    const w = buildPresetWidget(preset);
    expect(w.title).toBe(preset.label);
    expect(w.enabled).toBe(true);
    expect(w.render).toBeNull();
  });

  it('carries its schedule in the widget seconds, not preset milliseconds', () => {
    const preset = WIDGET_PRESETS.find((p) => p.kind === 'world_clock')!;
    expect(buildPresetWidget(preset).refreshEverySeconds).toBe(preset.refreshIntervalMs / 1000);
  });

  it('every preset maps to a refresh kind the dispatcher knows', () => {
    // A widget whose kind nothing serves would fall through to the agent path
    // and cost a model call to render a clock.
    for (const preset of WIDGET_PRESETS) {
      expect(buildPresetWidget(preset).refreshKind).toBeTruthy();
    }
  });
});

describe('the deterministic refresh', () => {
  it('renders a clock with no model call', async () => {
    // Pure computation — this is the whole reason the fetch path survives.
    const node = await refreshByKind('clocks');
    expect(node).toBeTruthy();
    expect(node!.type).toBe('statGrid');
  });

  it('returns null for a widget with no kind, so the agent path takes it', async () => {
    /*
     * The load-bearing negative. Guessing here would silently render a custom
     * widget with a built-in fetcher and quietly ignore its recipe.
     */
    expect(await refreshByKind(undefined)).toBeNull();
    expect(await refreshByKind('something-else')).toBeNull();
  });

  it('honours the config it is given', async () => {
    const node = await refreshByKind('clocks', {
      weather: { label: 'x', latitude: 0, longitude: 0 },
      tickers: [],
      clocks: [{ label: 'Reykjavik', tz: 'Atlantic/Reykjavik' }],
    });
    expect(JSON.stringify(node)).toContain('Reykjavik');
  });
});

describe('the card is an event again', () => {
  it('AssistantCard no longer carries a widget block', () => {
    /*
     * The bolt-on was the tell that state was living on an event primitive.
     * With presets moved, a card is only ever "something happened".
     */
    const store = fs.readFileSync(path.join(process.cwd(), 'src/stores/assistant-store.ts'), 'utf8');
    const iface = store.slice(store.indexOf('export interface AssistantCard'), store.indexOf('}', store.indexOf('export interface AssistantCard')));
    expect(iface).not.toMatch(/^\s*widget\??:/m);
  });

  it('nothing imports the retired card-refresh hook', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/hooks/use-assistant-widgets.ts'))).toBe(false);
  });
});
