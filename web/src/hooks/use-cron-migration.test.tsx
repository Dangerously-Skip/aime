// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { useCronMigration } from './use-cron-migration';
import { useCronStore } from '@/stores/cron-store';

/**
 * THE MIGRATION MUST BE SAFE TO RUN TWICE, AND MUST NOT START A HERD.
 *
 * Losing a job here is recoverable — the localStorage copy stays until step 5.
 * A job that fires TWICE is not, and neither is twenty firing at once because a
 * migration dropped their `lastRun`.
 */

const job = (over = {}) => ({
  id: 'c1', expression: '* * * * *', prompt: 'check the build',
  surfaceId: 'code', lastRun: null, enabled: true, createdAt: 1, ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

/** Whatever the migration PUT, or null if it never wrote. */
const written = () => {
  const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT');
  return put ? JSON.parse((put[1] as RequestInit).body as string).orders : null;
};

beforeEach(() => {
  useCronStore.setState({ jobs: [] } as never);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Server responds with `existing` on GET and accepts the PUT. */
function server(existing: unknown[] = [], putOk = true) {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? { ok: putOk, json: async () => ({ ok: putOk }) }
      : { ok: true, json: async () => ({ orders: existing }) },
  );
  vi.stubGlobal('fetch', fetchMock);
}

describe('migrating', () => {
  it('writes cron jobs into the manifest as attended orders', async () => {
    useCronStore.setState({ jobs: [job()] } as never);
    server();
    renderHook(() => useCronMigration());
    await waitFor(() => expect(written()).toBeTruthy());
    const [order] = written();
    expect(order.id).toBe('c1');
    expect(order.attended).toBe(true);
    expect(order.instruction).toBe('check the build');
    expect(order.surfaceId).toBe('code');
  });

  it('stamps a never-run job so it does not fire immediately', async () => {
    // The herd guard, through the real hook rather than the pure function.
    useCronStore.setState({ jobs: [job({ lastRun: null })] } as never);
    server();
    renderHook(() => useCronMigration());
    await waitFor(() => expect(written()).toBeTruthy());
    expect(written()[0].lastRun).toBeGreaterThan(0);
  });

  it('keeps the orders that were already there', async () => {
    /*
     * The route merges, but sending only the additions would read as a deletion
     * to any implementation that replaces — and standing orders are somebody's
     * real automation.
     */
    useCronStore.setState({ jobs: [job()] } as never);
    server([{ id: 'existing-order', instruction: 'keep me' }]);
    renderHook(() => useCronMigration());
    await waitFor(() => expect(written()).toBeTruthy());
    expect(written().map((o: { id: string }) => o.id).sort()).toEqual(['c1', 'existing-order']);
  });
});

describe('running twice is harmless', () => {
  it('does nothing when the manifest already has the job', async () => {
    useCronStore.setState({ jobs: [job({ id: 'already' })] } as never);
    server([{ id: 'already', instruction: 'x' }]);
    renderHook(() => useCronMigration());
    // Give the GET time to resolve; the point is no PUT ever follows.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(written(), 'a second run duplicated the job').toBeNull();
  });

  it('does nothing at all when there are no cron jobs', async () => {
    server();
    renderHook(() => useCronMigration());
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock, 'it hit the network with nothing to do').not.toHaveBeenCalled();
  });

  it('runs once per mount, not once per render', async () => {
    useCronStore.setState({ jobs: [job()] } as never);
    server();
    const { rerender } = renderHook(() => useCronMigration());
    await waitFor(() => expect(written()).toBeTruthy());
    rerender();
    rerender();
    const puts = fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'PUT');
    expect(puts).toHaveLength(1);
  });
});

describe('failing is safe', () => {
  it('leaves the jobs alone when the server cannot be read', async () => {
    /*
     * The cron store still ticks them, so the user loses nothing and the next
     * launch tries again. Guessing at the manifest contents would risk a
     * duplicate.
     */
    useCronStore.setState({ jobs: [job()] } as never);
    fetchMock = vi.fn(async () => { throw new Error('server starting'); });
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useCronMigration());
    await new Promise((r) => setTimeout(r, 20));
    expect(useCronStore.getState().jobs).toHaveLength(1);
  });

  it('never clears the cron store, even on success', async () => {
    // Step 5's job. Leaving it means a rollback still has the jobs, and the
    // dual read makes the leftover copy inert.
    useCronStore.setState({ jobs: [job()] } as never);
    server();
    renderHook(() => useCronMigration());
    await waitFor(() => expect(written()).toBeTruthy());
    expect(useCronStore.getState().jobs).toHaveLength(1);
  });

  it('says so when the write is rejected', async () => {
    useCronStore.setState({ jobs: [job()] } as never);
    server([], false);
    renderHook(() => useCronMigration());
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(useCronStore.getState().jobs).toHaveLength(1);
  });
});
