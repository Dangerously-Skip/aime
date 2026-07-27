// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useConnectorHealth } from './use-connector-health';

/**
 * Only `fetch` is stubbed — the hook's job is turning the endpoint's answer into
 * something the UI can render, so the endpoint shape is the contract under test.
 */

const fetchMock = vi.fn();
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

const body = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useConnectorHealth', () => {
  it('exposes which connections need reconnecting', async () => {
    fetchMock.mockResolvedValue(
      body({
        connectors: [
          { id: 'github', serverKey: 'aime-connector-github', health: { status: 'healthy', needsReconnect: false, detail: 'Connected.' } },
          { id: 'google-personal', serverKey: 'aime-connector-google-personal', health: { status: 'expired', needsReconnect: true, detail: 'Access expired…' } },
        ],
        needsReconnect: ['google-personal'],
      }),
    );

    const { result } = renderHook(() => useConnectorHealth([]));
    await waitFor(() => expect(result.current.reports).toHaveLength(2));

    expect(result.current.needsReconnect.has('google-personal')).toBe(true);
    expect(result.current.needsReconnect.has('github')).toBe(false);
    expect(result.current.healthOf('github')?.status).toBe('healthy');
    expect(result.current.healthOf('nope')).toBeUndefined();
  });

  it('sends the ids the UI believes are connected so the server can report drift', async () => {
    fetchMock.mockResolvedValue(body({ connectors: [], needsReconnect: [], drift: { missingInClient: ['atlassian'], missingOnDisk: [] } }));

    const { result } = renderHook(() => useConnectorHealth(['github', 'slack']));
    await waitFor(() => expect(result.current.drift).not.toBeNull());

    expect(urls()[0]).toContain('clientConnected=github%2Cslack');
    expect(result.current.drift).toEqual({ missingInClient: ['atlassian'], missingOnDisk: [] });
  });

  it('omits the query when the UI claims nothing', async () => {
    fetchMock.mockResolvedValue(body({ connectors: [], needsReconnect: [] }));
    renderHook(() => useConnectorHealth([]));
    await waitFor(() => expect(urls()).toHaveLength(1));
    expect(urls()[0]).toBe('/api/connectors/health');
  });

  it('does not refetch when the caller passes a new array with the same ids', async () => {
    fetchMock.mockResolvedValue(body({ connectors: [], needsReconnect: [] }));
    const { rerender } = renderHook(({ ids }) => useConnectorHealth(ids), {
      initialProps: { ids: ['b', 'a'] },
    });
    await waitFor(() => expect(urls()).toHaveLength(1));

    // a fresh array each render is the normal React case; order-insensitive too
    rerender({ ids: ['a', 'b'] });
    rerender({ ids: ['b', 'a'] });
    await new Promise((r) => setTimeout(r, 10));
    expect(urls()).toHaveLength(1);
  });

  it('refetches when the claimed set genuinely changes', async () => {
    fetchMock.mockResolvedValue(body({ connectors: [], needsReconnect: [] }));
    const { rerender } = renderHook(({ ids }) => useConnectorHealth(ids), {
      initialProps: { ids: ['a'] },
    });
    await waitFor(() => expect(urls()).toHaveLength(1));
    rerender({ ids: ['a', 'b'] });
    await waitFor(() => expect(urls()).toHaveLength(2));
  });

  it('stays quiet when the endpoint fails — health is advisory', async () => {
    fetchMock.mockResolvedValue(body({ error: 'boom' }, 500));
    const { result } = renderHook(() => useConnectorHealth([]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reports).toEqual([]);
    expect(result.current.needsReconnect.size).toBe(0);
  });

  it('survives a network error without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useConnectorHealth([]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reports).toEqual([]);
  });

  it('picks up a change after refresh() — the reconnect case', async () => {
    fetchMock.mockResolvedValueOnce(
      body({ connectors: [{ id: 'x', serverKey: 'aime-connector-x', health: { status: 'expired', needsReconnect: true, detail: '' } }], needsReconnect: ['x'] }),
    );
    const { result } = renderHook(() => useConnectorHealth([]));
    await waitFor(() => expect(result.current.needsReconnect.has('x')).toBe(true));

    // user reconnects; the next poll should clear it
    fetchMock.mockResolvedValueOnce(
      body({ connectors: [{ id: 'x', serverKey: 'aime-connector-x', health: { status: 'healthy', needsReconnect: false, detail: '' } }], needsReconnect: [] }),
    );
    await result.current.refresh();
    await waitFor(() => expect(result.current.needsReconnect.has('x')).toBe(false));
  });
});
