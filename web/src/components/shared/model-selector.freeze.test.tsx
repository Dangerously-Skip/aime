// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ModelSelector } from './model-selector';
import { useProviderStore } from '@/stores/provider-store';

/**
 * ModelSelector must not rehydrate a global store from an effect.
 *
 * It used to:
 *
 *   useEffect(() => { if (onSelectModel) void useProviderStore.persist.rehydrate(); },
 *            [onSelectModel]);
 *
 * `onSelectModel` is a function prop and every call site passes an inline arrow
 * (chat-surface, code-surface, project-detail), so its identity changes on each
 * parent render. The effect re-ran, rehydrate() replaced the providers array,
 * subscribers re-rendered, the prop was recreated, and the effect re-ran —
 * forever, at 100% CPU, rebuilding the option list over every model each cycle.
 *
 * With a 341-model OpenRouter provider configured the renderer never painted
 * again. The window kept showing its last frame, so it looked like a dead
 * button: DevTools could not display the DOM, the console could not execute, and
 * the last thing painted happened to be the final onboarding step. Confirmed
 * from the outside as a renderer process pegged at 101% CPU for 88 minutes.
 *
 * The store is now rehydrated centrally by StoreHydration. This test guards the
 * engine of the loop rather than its symptom: a component-triggered rehydrate.
 */

beforeEach(() => {
  useProviderStore.setState({ providers: [], hasCredentials: {} } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ModelSelector — does not drive a rehydrate loop', () => {
  it('never rehydrates the provider store, however often the parent re-renders', () => {
    const rehydrate = vi.spyOn(useProviderStore.persist, 'rehydrate');

    // A fresh inline handler each render, exactly as every real call site does.
    const { rerender } = render(
      <ModelSelector value="sonnet" onChange={() => {}} onSelectModel={(o) => void o} />,
    );
    for (let i = 0; i < 5; i++) {
      rerender(<ModelSelector value="sonnet" onChange={() => {}} onSelectModel={(o) => void o} />);
    }

    expect(rehydrate).not.toHaveBeenCalled();
  });

  it('renders a large provider catalogue without hanging', () => {
    // 341 is what OpenRouter actually returns; the loop only became fatal at
    // this size, because each iteration rebuilt the whole option list.
    const models = Array.from({ length: 341 }, (_, i) => ({
      id: `vendor/model-${i}`,
      label: `Model ${i}`,
      capabilities: ['chat', 'code'] as const,
      contextWindow: 200_000,
      pricing: { inputPer1kUsd: 0.001, outputPer1kUsd: 0.002 },
    }));
    useProviderStore.setState({
      providers: [{ id: 'p1', presetId: 'openrouter', label: 'OpenRouter', enabled: true, models }],
      hasCredentials: { p1: true },
    } as never);

    const started = Date.now();
    render(<ModelSelector value="sonnet" onChange={() => {}} onSelectModel={(o) => void o} />);
    // Generous: the point is "returns at all", not a performance budget.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
