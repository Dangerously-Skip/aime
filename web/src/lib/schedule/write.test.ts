import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAttendedJob, setJobEnabled, deleteJob } from './write';
import { isJobDue } from './due';
import { attendedJobs } from './attended-jobs';

/**
 * NEW JOBS GO STRAIGHT TO THE MANIFEST (DR-24 step 5).
 *
 * Every creation path used to write the browser cron store, and the migration
 * moved it across on the NEXT launch. That worked — the dual read ticks both —
 * but the store never emptied, so step 6 could never happen.
 *
 * The behavioural difference that matters: the store call could not fail, and a
 * round trip can. A caller that ignores the result silently loses the user's job.
 */

let fetchMock: ReturnType<typeof vi.fn>;

const written = () => {
  const put = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PUT');
  return put ? JSON.parse((put[1] as RequestInit).body as string).orders : null;
};

function server(existing: unknown[] = [], opts: { getOk?: boolean; putOk?: boolean } = {}) {
  const { getOk = true, putOk = true } = opts;
  fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? { ok: putOk, json: async () => ({}) }
      : { ok: getOk, json: async () => ({ orders: existing }) },
  );
  vi.stubGlobal('fetch', fetchMock);
}

const NEW = { expression: '0 9 * * *', prompt: 'morning briefing', surfaceId: 'browser' };

beforeEach(() => { server(); });
afterEach(() => vi.unstubAllGlobals());

describe('creating', () => {
  it('writes an attended order and returns its id', async () => {
    const id = await createAttendedJob(NEW);
    expect(id).toBeTruthy();
    const [order] = written();
    expect(order.attended).toBe(true);
    expect(order.instruction).toBe('morning briefing');
    expect(order.surfaceId).toBe('browser');
    expect(order.trigger).toEqual({ type: 'cron', expression: '0 9 * * *' });
  });

  it('does not fire in the minute it was created', async () => {
    /*
     * A `* * * * *` job created mid-minute would otherwise be due immediately,
     * which reads as the UI running it on save. Same reasoning as the
     * migration's herd guard.
     */
    await createAttendedJob({ ...NEW, expression: '* * * * *' });
    const [order] = written();
    expect(isJobDue(order, order.lastRun + 1_000)).toBe(false);
  });

  it('keeps the orders that were already there', async () => {
    server([{ id: 'existing', instruction: 'keep me' }]);
    await createAttendedJob(NEW);
    expect(written().map((o: { id: string }) => o.id)).toContain('existing');
    expect(written()).toHaveLength(2);
  });

  it('the new job is picked up by the ticker', async () => {
    // End to end through the real merge: created here, ticked there.
    await createAttendedJob(NEW);
    const ticked = attendedJobs(written(), []);
    expect(ticked).toHaveLength(1);
    expect(ticked[0].source).toBe('manifest');
    expect(ticked[0].surfaceId).toBe('browser');
  });
});

describe('failing is reported, not swallowed', () => {
  it('returns null when the manifest cannot be read', async () => {
    /*
     * The store call could not fail. A caller that ignores this loses the user's
     * job silently — so it must be possible to notice.
     */
    server([], { getOk: false });
    expect(await createAttendedJob(NEW)).toBeNull();
  });

  it('returns null when the write is rejected', async () => {
    server([], { putOk: false });
    expect(await createAttendedJob(NEW)).toBeNull();
  });

  it('returns null when the network throws', async () => {
    fetchMock = vi.fn(async () => { throw new Error('offline'); });
    vi.stubGlobal('fetch', fetchMock);
    expect(await createAttendedJob(NEW)).toBeNull();
  });

  it('never writes a partial list after a failed read', async () => {
    // Writing `[newJob]` on a failed read would DELETE every existing order.
    server([{ id: 'precious' }], { getOk: false });
    await createAttendedJob(NEW);
    expect(written(), 'it wrote after failing to read').toBeNull();
  });
});

describe('pausing and deleting', () => {
  const existing = [
    { id: 'a', instruction: 'x', status: 'active' },
    { id: 'b', instruction: 'y', status: 'active' },
  ];

  it('pausing sets status without touching the others', async () => {
    server(existing);
    expect(await setJobEnabled('a', false)).toBe(true);
    const out = written();
    expect(out.find((o: { id: string }) => o.id === 'a').status).toBe('paused');
    expect(out.find((o: { id: string }) => o.id === 'b').status).toBe('active');
  });

  it('resuming sets it back', async () => {
    server([{ id: 'a', instruction: 'x', status: 'paused' }]);
    await setJobEnabled('a', true);
    expect(written()[0].status).toBe('active');
  });

  it('a paused job is not due', async () => {
    server([{ id: 'a', instruction: 'x', status: 'active', trigger: { type: 'cron', expression: '* * * * *' }, runCount: 0 }]);
    await setJobEnabled('a', false);
    expect(isJobDue(written()[0], Date.now())).toBe(false);
  });

  it('deleting removes only that job', async () => {
    server(existing);
    expect(await deleteJob('a')).toBe(true);
    expect(written().map((o: { id: string }) => o.id)).toEqual(['b']);
  });

  it('deleting something absent is a no-op, not an error', async () => {
    server(existing);
    expect(await deleteJob('never-existed')).toBe(true);
    expect(written()).toHaveLength(2);
  });
});
