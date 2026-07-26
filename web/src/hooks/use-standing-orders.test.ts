// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useStandingOrders, applyInboxEntry } from './use-standing-orders';
import { useAssistantStore, type StandingOrder } from '@/stores/assistant-store';
import { useContextBusStore } from '@/stores/context-bus-store';
import type { InboxEntry, ManifestOrder } from '@/lib/orders/manifest';

/**
 * C5b changed this hook's job: the SERVER executes standing orders; the
 * renderer mirrors state and replays the results inbox into its stores. These
 * tests pin the ownership rule (the renderer never executes) and the replay
 * semantics (ack AFTER apply).
 */

function installMinuteTickMock() {
  const listeners = new Set<(ts: number) => void>();
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    onMinuteTick: (cb: (ts: number) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    tick: async (ts: number) => {
      await act(async () => {
        await Promise.all([...listeners].map((l) => l(ts)));
      });
    },
  };
}

const order = (over: Partial<StandingOrder> = {}): StandingOrder => ({
  id: 'o1',
  instruction: 'Watch AAPL and report when it crosses $200',
  trigger: { type: 'interval', expression: '30m' },
  state: {},
  status: 'active',
  notifyVia: 'assistant',
  runCount: 0,
  errorCount: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const entry = (over: Partial<InboxEntry> = {}): InboxEntry => ({
  id: 'in_1',
  orderId: 'o1',
  ts: 1_000,
  kind: 'result',
  title: 'Watch AAPL',
  summary: 'AAPL is at $187.',
  notifyVia: 'assistant',
  ...over,
});

const fetchMock = vi.fn();
const calls = (url: string, method: string) =>
  fetchMock.mock.calls.filter(
    (c) => String(c[0]).includes(url) && ((c[1] as RequestInit | undefined)?.method ?? 'GET') === method,
  );

function serve(opts: { manifest?: ManifestOrder[]; inbox?: InboxEntry[] } = {}) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/inbox')) {
      if (method === 'POST') return new Response('{"ok":true}', { status: 200 });
      return new Response(JSON.stringify({ entries: opts.inbox ?? [] }), { status: 200 });
    }
    if (u.includes('/api/schedule/orders')) {
      if (method === 'PUT') return new Response('{"ok":true}', { status: 200 });
      return new Response(JSON.stringify({ orders: opts.manifest ?? [] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
  useAssistantStore.setState({ orders: [], cards: [], activity: [] });
  useContextBusStore.setState({ events: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useStandingOrders (sync + replay)', () => {
  it('pushes the order list to the server manifest', async () => {
    useAssistantStore.setState({ orders: [order()] });
    installMinuteTickMock();
    renderHook(() => useStandingOrders());

    await waitFor(() => expect(calls('/api/schedule/orders', 'PUT').length).toBeGreaterThan(0));
    const body = JSON.parse((calls('/api/schedule/orders', 'PUT')[0][1] as RequestInit).body as string);
    expect(body.orders[0]).toMatchObject({ id: 'o1', instruction: order().instruction });
  });

  // Work done while the window was closed must land in the stores.
  it('merges server-side execution results back onto the store order', async () => {
    useAssistantStore.setState({ orders: [order({ runCount: 2, lastRun: 1_000 })] });
    serve({
      manifest: [
        {
          ...order(),
          runCount: 5,
          lastRun: 9_000,
          errorCount: 0,
          state: { lastPrice: 190 },
          totalCost: 0.02,
        } as ManifestOrder,
      ],
    });
    installMinuteTickMock();
    renderHook(() => useStandingOrders());

    await waitFor(() => expect(useAssistantStore.getState().getOrder('o1')?.runCount).toBe(5));
    expect(useAssistantStore.getState().getOrder('o1')?.state).toEqual({ lastPrice: 190 });
  });

  it('does not let a STALE server copy overwrite newer local counters', async () => {
    useAssistantStore.setState({ orders: [order({ runCount: 7, lastRun: 9_000 })] });
    serve({ manifest: [{ ...order(), runCount: 2, lastRun: 1_000 } as ManifestOrder] });
    installMinuteTickMock();
    renderHook(() => useStandingOrders());

    await waitFor(() => expect(calls('/api/schedule/orders', 'GET').length).toBeGreaterThan(0));
    expect(useAssistantStore.getState().getOrder('o1')?.runCount).toBe(7);
  });

  it('replays a result entry into a card and acks AFTER applying', async () => {
    useAssistantStore.setState({ orders: [order()] });
    serve({ inbox: [entry()] });
    installMinuteTickMock();
    renderHook(() => useStandingOrders());

    await waitFor(() => expect(useAssistantStore.getState().cards).toHaveLength(1));
    expect(useAssistantStore.getState().cards[0]).toMatchObject({ orderId: 'o1', summary: 'AAPL is at $187.' });

    await waitFor(() => expect(calls('/inbox', 'POST').length).toBe(1));
    const ack = JSON.parse((calls('/inbox', 'POST')[0][1] as RequestInit).body as string);
    expect(ack.ids).toEqual(['in_1']);
  });

  it('replays completion and pause entries onto order status', async () => {
    useAssistantStore.setState({ orders: [order({ id: 'a' }), order({ id: 'b' })] });
    serve({
      inbox: [
        entry({ id: 'in_a', orderId: 'a', kind: 'completed', title: 'done' }),
        entry({ id: 'in_b', orderId: 'b', kind: 'paused', title: 'paused', summary: 'too many errors' }),
      ],
    });
    installMinuteTickMock();
    renderHook(() => useStandingOrders());

    await waitFor(() => expect(useAssistantStore.getState().getOrder('a')?.status).toBe('completed'));
    expect(useAssistantStore.getState().getOrder('b')?.status).toBe('paused');
  });

  // Ownership: the renderer must never execute an order itself.
  it('never calls the chat API, even with a due order and ticking clock', async () => {
    const mock = installMinuteTickMock();
    useAssistantStore.setState({ orders: [order()] }); // never run ⇒ "due"
    renderHook(() => useStandingOrders());

    await mock.tick(Date.now());
    await mock.tick(Date.now() + 60_000);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/chat'))).toBe(false);
  });
});

describe('applyInboxEntry', () => {
  it('publishes results to the context bus with inject: routing', () => {
    applyInboxEntry(entry({ notifyVia: 'inject:cowork', summary: 'big news' }));
    const events = useContextBusStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ priority: 'p0', targetSurface: 'cowork' });
  });

  it('survives a malformed A2UI doc — the card still renders its text', () => {
    applyInboxEntry(entry({ docJson: '{broken' }));
    expect(useAssistantStore.getState().cards[0]).toMatchObject({ summary: 'AAPL is at $187.' });
  });

  it('records error entries as activity without touching cards', () => {
    applyInboxEntry(entry({ kind: 'error', error: 'upstream 502' }));
    expect(useAssistantStore.getState().cards).toHaveLength(0);
    expect(useAssistantStore.getState().activity[0]).toMatchObject({ type: 'order-error' });
  });
});
