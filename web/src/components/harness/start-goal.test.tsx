// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { StartGoal, DEFAULT_BUDGET_USD } from './start-goal';

/**
 * Starting a run is where the model route is decided, and getting that wrong is
 * not a small bug: a caller that lets the SERVER pick resolves against the
 * built-in Anthropic registry and demands an Anthropic key, so the whole feature
 * dies for an OpenRouter-only user while every other surface works.
 */
vi.mock('@/stores/provider-store', () => ({
  useProviderStore: (sel: (s: unknown) => unknown) => sel({ providers: [] }),
}));
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (sel: (s: unknown) => unknown) => sel({ tierModels: {} }),
}));
vi.mock('@/hooks/use-builtin-access', () => ({
  useBuiltinAccess: () => ({ hasAnthropicKey: true, hasBedrock: false, known: true }),
}));
vi.mock('@/lib/models/client-options', () => ({
  resolveSendRoute: () => ({ model: 'resolved-model', providerConfig: { providerId: 'p1' } }),
}));

let calls: { url: string; body: Record<string, unknown> }[] = [];

function mockFetch(responses: { ok: boolean; body?: unknown }[]) {
  let i = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: r.ok, status: r.ok ? 200 : 422, json: async () => r.body ?? {} };
  }) as unknown as typeof fetch;
}

beforeEach(() => { calls = []; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const setup = () =>
  render(<StartGoal conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);

async function submit(objective = 'Make the tests pass') {
  fireEvent.change(screen.getByPlaceholderText(/What should be true/i), {
    target: { value: objective },
  });
  fireEvent.click(screen.getByRole('button', { name: /Plan and start/i }));
}

describe('StartGoal', () => {
  it('sends the CLIENT-resolved model and providerConfig, not nothing', async () => {
    global.fetch = mockFetch([{ ok: true }, { ok: true }]);
    setup();
    await submit();
    await waitFor(() => expect(calls.length).toBe(2));
    for (const c of calls) {
      expect(c.body.model).toBe('resolved-model');
      expect(c.body.providerConfig).toEqual({ providerId: 'p1' });
    }
  });

  it('plans first, then starts — two calls, in order', async () => {
    // They fail differently, and the user should see which happened.
    global.fetch = mockFetch([{ ok: true }, { ok: true }]);
    setup();
    await submit();
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[0].url).toContain('/api/harness/init');
    expect(calls[1].url).toBe('/api/harness');
  });

  it('does NOT start when planning fails', async () => {
    global.fetch = mockFetch([{ ok: false, body: { error: 'plan has no tasks' } }]);
    setup();
    await submit();
    await waitFor(() => expect(screen.getByText(/plan has no tasks/)).toBeTruthy());
    expect(calls).toHaveLength(1);
  });

  it('shows the server’s own words rather than a generic failure', async () => {
    // "Something went wrong" hides the one thing that says whether to retry or
    // rewrite the objective.
    global.fetch = mockFetch([{ ok: false, body: { error: 'task "x" has no verification steps' } }]);
    setup();
    await submit();
    await waitFor(() => expect(screen.getByText(/no verification steps/)).toBeTruthy());
  });

  it('sends the budget and session cap the user can see', async () => {
    global.fetch = mockFetch([{ ok: true }, { ok: true }]);
    setup();
    await submit();
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[0].body.budgetUsd).toBe(DEFAULT_BUDGET_USD);
    expect(Number(calls[0].body.sessionCap)).toBeGreaterThan(0);
  });

  it('refuses a zero or negative budget before spending anything', async () => {
    global.fetch = mockFetch([{ ok: true }]);
    setup();
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_BUDGET_USD)), { target: { value: '0' } });
    await submit();
    await waitFor(() => expect(screen.getByText(/budget above zero/i)).toBeTruthy());
    expect(calls).toHaveLength(0);
  });

  it('will not submit an empty objective', () => {
    global.fetch = mockFetch([{ ok: true }]);
    setup();
    expect(screen.getByRole('button', { name: /Plan and start/i }).hasAttribute('disabled')).toBe(true);
  });
});
