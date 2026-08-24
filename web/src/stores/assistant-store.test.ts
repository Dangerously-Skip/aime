import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAssistantStore } from './assistant-store';

// addOrder fire-and-forgets a telemetry POST; keep tests offline
vi.mock('@/lib/telemetry/events', () => ({
  sendFeatureAdoptionEvent: vi.fn(),
}));

beforeEach(() => {
  useAssistantStore.setState({ orders: [], cards: [], activity: [] });
});

const store = () => useAssistantStore.getState();

const orderInput = {
  instruction: 'Check the deploy dashboard',
  trigger: { type: 'interval' as const, expression: '1h' },
  notifyVia: 'assistant',
};

describe('standing order CRUD', () => {
  it('addOrder initializes defaults and logs activity', () => {
    const id = store().addOrder(orderInput);
    const order = store().getOrder(id)!;

    expect(order).toMatchObject({
      instruction: 'Check the deploy dashboard',
      status: 'active',
      runCount: 0,
      errorCount: 0,
      state: {},
    });
    expect(order.createdAt).toBeGreaterThan(0);

    const activity = store().activity;
    expect(activity[0].type).toBe('order-created');
    expect(activity[0].orderId).toBe(id);
  });

  it('pause and resume flip status; resume clears errorCount', () => {
    const id = store().addOrder(orderInput);
    store().pauseOrder(id);
    expect(store().getOrder(id)?.status).toBe('paused');

    store().updateOrder(id, { errorCount: 3 });
    store().resumeOrder(id);
    const resumed = store().getOrder(id)!;
    expect(resumed.status).toBe('active');
    expect(resumed.errorCount).toBe(0);
  });

  it('completeOrder marks completed and logs activity', () => {
    const id = store().addOrder(orderInput);
    store().completeOrder(id);
    expect(store().getOrder(id)?.status).toBe('completed');
    expect(store().activity[0].type).toBe('order-completed');
  });

  it('resumeAllPaused only touches paused orders', () => {
    const paused = store().addOrder(orderInput);
    const completed = store().addOrder(orderInput);
    store().pauseOrder(paused);
    store().completeOrder(completed);

    store().resumeAllPaused();
    expect(store().getOrder(paused)?.status).toBe('active');
    expect(store().getOrder(completed)?.status).toBe('completed');
  });

  it('removeOrder deletes the order', () => {
    const id = store().addOrder(orderInput);
    store().removeOrder(id);
    expect(store().getOrder(id)).toBeUndefined();
  });
});

describe('card feed', () => {
  it('regular cards arrive unread and unpinned, newest first', () => {
    store().addCard({ title: 'First' });
    const secondId = store().addCard({ title: 'Second' });

    const cards = store().cards;
    expect(cards[0].id).toBe(secondId);
    expect(cards[0].unread).toBe(true);
    expect(cards[0].pinned).toBe(false);
  });

  it('markAllRead clears unread flags', () => {
    store().addCard({ title: 'a' });
    store().addCard({ title: 'b' });
    store().markAllRead();
    expect(store().cards.every((c) => !c.unread)).toBe(true);
  });

  it('clearOldCards drops stale cards but keeps pinned ones', () => {
    store().addCard({ title: 'fresh' });
    const pinnedId = store().addCard({ title: 'old-but-pinned' });
    store().pinCard(pinnedId);

    // Age both an unpinned and the pinned card past the cutoff
    useAssistantStore.setState((state) => ({
      cards: state.cards.map((c) =>
        c.title !== 'fresh' ? { ...c, timestamp: Date.now() - 10 * 86400000 } : c,
      ).concat([{ ...state.cards[0], id: 'stale', title: 'stale', pinned: false, timestamp: Date.now() - 10 * 86400000 }]),
    }));

    store().clearOldCards(7);
    const titles = store().cards.map((c) => c.title).sort();
    expect(titles).toEqual(['fresh', 'old-but-pinned']);
  });

  it('updateCard patches a card in place', () => {
    const id = store().addCard({ title: 'before' });
    store().updateCard(id, { title: 'after', summary: 'now with summary' });
    expect(store().cards[0]).toMatchObject({ title: 'after', summary: 'now with summary' });
  });
});

describe('activity log', () => {
  it('keeps at most 500 entries', () => {
    for (let i = 0; i < 520; i++) {
      store().addActivity({ type: 'user-action', label: `entry ${i}` });
    }
    expect(store().activity).toHaveLength(500);
    expect(store().activity[0].label).toBe('entry 519');
  });

  it('getActivityForOrder filters by orderId', () => {
    store().addActivity({ type: 'order-fired', label: 'x', orderId: 'o1' });
    store().addActivity({ type: 'order-fired', label: 'y', orderId: 'o2' });
    expect(store().getActivityForOrder('o1')).toHaveLength(1);
  });
});

describe('migrateCronJobs', () => {
  const cronJob = {
    id: 'legacy1',
    expression: '0 9 * * *',
    prompt: 'morning briefing',
    surfaceId: 'assistant',
    enabled: true,
    createdAt: 12345,
  };

  it('converts cron jobs into standing orders preserving id and enabled state', () => {
    store().migrateCronJobs([cronJob, { ...cronJob, id: 'legacy2', enabled: false }]);

    const orders = store().orders;
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({
      id: 'legacy1',
      instruction: 'morning briefing',
      trigger: { type: 'cron', expression: '0 9 * * *' },
      status: 'active',
      createdAt: 12345,
    });
    expect(orders[1].status).toBe('paused');
    expect(store().activity[0].label).toContain('Migrated 2');
  });

  it('is idempotent — already-migrated ids are skipped', () => {
    store().migrateCronJobs([cronJob]);
    store().migrateCronJobs([cronJob]);
    expect(store().orders).toHaveLength(1);
  });
});
