// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useBuiltinAccess, resetServerCredentials } from './use-builtin-access';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * Built-in (Claude) reachability is the union of three credentials, only one of
 * which the browser can see. Getting it wrong in either direction has a cost:
 * too permissive and a BYOK-only user is offered models that make the Agent SDK
 * demand an Anthropic login; too strict and a developer running with a `.env`
 * key loses their model picker.
 */

const fetchMock = vi.fn();

function mockServer(body: { anthropic: boolean; bedrock: boolean }) {
  fetchMock.mockResolvedValue(Response.json(body));
}

beforeEach(() => {
  resetServerCredentials();
  useSettingsStore.setState({ anthropicApiKey: null });
  fetchMock.mockReset();
  mockServer({ anthropic: false, bedrock: false });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useBuiltinAccess', () => {
  it('is optimistic until the server answers, then honest', async () => {
    const { result } = renderHook(() => useBuiltinAccess());
    // Before the round trip: don't flicker the built-ins away for an env-key user.
    expect(result.current.hasBuiltins).toBe(true);
    await waitFor(() => expect(result.current.hasBuiltins).toBe(false));
    expect(result.current.hasAnthropicKey).toBe(false);
    expect(result.current.hasBedrock).toBe(false);
  });

  it("counts the server's env key even with nothing in Settings", async () => {
    mockServer({ anthropic: true, bedrock: false });
    const { result } = renderHook(() => useBuiltinAccess());
    await waitFor(() => expect(result.current.hasAnthropicKey).toBe(true));
    expect(result.current.hasBuiltins).toBe(true);
  });

  it('counts Bedrock', async () => {
    mockServer({ anthropic: false, bedrock: true });
    const { result } = renderHook(() => useBuiltinAccess());
    await waitFor(() => expect(result.current.hasBedrock).toBe(true));
    expect(result.current.hasAnthropicKey).toBe(false);
    expect(result.current.hasBuiltins).toBe(true);
  });

  it("counts the user's own key without waiting on the server", () => {
    useSettingsStore.setState({ anthropicApiKey: 'sk-ant-test' });
    const { result } = renderHook(() => useBuiltinAccess());
    expect(result.current.hasAnthropicKey).toBe(true);
  });

  it('asks the server once, however many components mount', async () => {
    const a = renderHook(() => useBuiltinAccess());
    renderHook(() => useBuiltinAccess());
    renderHook(() => useBuiltinAccess());
    await waitFor(() => expect(a.result.current.hasBuiltins).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/models');
  });

  it('stays optimistic — and retries later — when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const first = renderHook(() => useBuiltinAccess());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // No answer ⇒ never hide the built-ins on a transient network failure.
    expect(first.result.current.hasBuiltins).toBe(true);

    mockServer({ anthropic: true, bedrock: false });
    const second = renderHook(() => useBuiltinAccess());
    await waitFor(() => expect(second.result.current.hasAnthropicKey).toBe(true));
  });

  it('returns a stable object so callers can memoise on it', () => {
    const { result, rerender } = renderHook(() => useBuiltinAccess());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
