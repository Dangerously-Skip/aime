import { describe, it, expect, beforeEach } from 'vitest';
import { useContextBusStore } from './context-bus-store';

beforeEach(() => {
  useContextBusStore.setState({ events: [] });
});

const bus = () => useContextBusStore.getState();

describe('context bus', () => {
  it('publish assigns id, timestamp and unconsumed state', () => {
    bus().publish({ source: 'user', priority: 'p1', summary: 'hello' });
    const [event] = bus().events;
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeGreaterThan(0);
    expect(event.consumed).toBe(false);
    expect(event.summary).toBe('hello');
  });

  it('consume marks only the targeted event', () => {
    bus().publish({ source: 'a', priority: 'p1', summary: 'one' });
    bus().publish({ source: 'a', priority: 'p1', summary: 'two' });
    const [first] = bus().events;

    bus().consume(first.id);
    expect(bus().events.find((e) => e.id === first.id)?.consumed).toBe(true);
    expect(bus().getUnconsumed().map((e) => e.summary)).toEqual(['two']);
  });

  it('getUnconsumed filters by surface, including broadcasts', () => {
    bus().publish({ source: 'a', priority: 'p1', summary: 'broadcast' });
    bus().publish({ source: 'a', priority: 'p1', summary: 'for-chat', targetSurface: 'chat' });
    bus().publish({ source: 'a', priority: 'p1', summary: 'for-cowork', targetSurface: 'cowork' });

    expect(bus().getUnconsumed('chat').map((e) => e.summary)).toEqual(['broadcast', 'for-chat']);
    expect(bus().getUnconsumed().map((e) => e.summary)).toHaveLength(3);
  });

  it('consumeAll consumes broadcasts and surface-targeted events only', () => {
    bus().publish({ source: 'a', priority: 'p0', summary: 'broadcast' });
    bus().publish({ source: 'a', priority: 'p1', summary: 'for-chat', targetSurface: 'chat' });
    bus().publish({ source: 'a', priority: 'p1', summary: 'for-cowork', targetSurface: 'cowork' });

    bus().consumeAll('chat');
    expect(bus().getUnconsumed().map((e) => e.summary)).toEqual(['for-cowork']);
  });

  it('getUnreadCount counts only unconsumed p0/p1 for the surface', () => {
    bus().publish({ source: 'a', priority: 'p0', summary: 'urgent' });
    bus().publish({ source: 'a', priority: 'p1', summary: 'relevant', targetSurface: 'chat' });
    bus().publish({ source: 'a', priority: 'p2', summary: 'informational' });
    bus().publish({ source: 'a', priority: 'p1', summary: 'other-surface', targetSurface: 'cowork' });

    expect(bus().getUnreadCount('chat')).toBe(2);
  });

  it('clearOlderThan removes stale events', () => {
    bus().publish({ source: 'a', priority: 'p1', summary: 'fresh' });
    useContextBusStore.setState((state) => ({
      events: [
        ...state.events,
        { ...state.events[0], id: 'stale', summary: 'stale', timestamp: Date.now() - 10 * 60000 },
      ],
    }));

    bus().clearOlderThan(5);
    expect(bus().events.map((e) => e.summary)).toEqual(['fresh']);
  });
});
