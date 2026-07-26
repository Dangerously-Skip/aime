import { describe, it, expect, beforeEach } from 'vitest';
import { handleWidgetCreateEvent } from './handle-create-event';
import { useWidgetStore } from '@/stores/widget-store';

const s = () => useWidgetStore.getState();

beforeEach(() => {
  useWidgetStore.setState({ widgets: [] });
});

describe('handleWidgetCreateEvent — the chat → Cockpit pin loop', () => {
  it('lands a well-formed event in the widget store', () => {
    const w = handleWidgetCreateEvent({
      id: 'wg_1',
      input: { title: 'AAPL price', recipe: 'Show the AAPL price with trend', refreshEvery: '30m', allowWeb: true },
    });
    expect(w).toMatchObject({
      id: 'wg_1',
      title: 'AAPL price',
      recipe: 'Show the AAPL price with trend',
      refreshEverySeconds: 1_800,
      allowWeb: true,
      enabled: true,
      render: null,
    });
    expect(s().widgets).toHaveLength(1);
  });

  it('creates a manual-refresh widget when the interval is absent or unreadable', () => {
    expect(handleWidgetCreateEvent({ input: { title: 'a', recipe: 'b' } })?.refreshEverySeconds).toBeUndefined();
    expect(
      handleWidgetCreateEvent({ input: { title: 'a', recipe: 'b', refreshEvery: 'whenever' } })?.refreshEverySeconds,
    ).toBeUndefined();
  });

  // A bad tool call must not break the stream that carried it.
  it('returns null on unusable payloads without touching the store', () => {
    for (const event of [
      {},
      { input: {} },
      { input: { title: 'no recipe' } },
      { input: { title: '   ', recipe: 'x' } },
      { input: { title: 42, recipe: 'x' } },
    ]) {
      expect(handleWidgetCreateEvent(event as Record<string, unknown>)).toBeNull();
    }
    expect(s().widgets).toHaveLength(0);
  });

  it('caps runaway title and recipe lengths', () => {
    const w = handleWidgetCreateEvent({
      input: { title: 't'.repeat(500), recipe: 'r'.repeat(10_000) },
    })!;
    expect(w.title.length).toBe(120);
    expect(w.recipe.length).toBe(4_000);
  });

  it('upserts by id so a retried tool call does not duplicate', () => {
    handleWidgetCreateEvent({ id: 'wg_1', input: { title: 'a', recipe: 'r1' } });
    handleWidgetCreateEvent({ id: 'wg_1', input: { title: 'a', recipe: 'r2' } });
    expect(s().widgets).toHaveLength(1);
    expect(s().widgets[0].recipe).toBe('r2');
  });
});

describe('widget-store basics', () => {
  it('setRender stamps the node and refresh time', () => {
    handleWidgetCreateEvent({ id: 'w1', input: { title: 'a', recipe: 'b' } });
    s().setRender('w1', { type: 'divider' }, 12_345);
    expect(s().getWidget('w1')).toMatchObject({ render: { type: 'divider' }, refreshedAt: 12_345 });
  });

  it('setEnabled and removeWidget behave', () => {
    handleWidgetCreateEvent({ id: 'w1', input: { title: 'a', recipe: 'b' } });
    s().setEnabled('w1', false);
    expect(s().getWidget('w1')?.enabled).toBe(false);
    s().removeWidget('w1');
    expect(s().widgets).toHaveLength(0);
  });
});
