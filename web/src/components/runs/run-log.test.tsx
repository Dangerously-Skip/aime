// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { RunLog } from './run-log';
import { useRunLog } from './use-run-log';
import { useRunStore } from '@/stores/run-store';
import type { Run } from '@/lib/runs/types';

/**
 * The ad-hoc run log — moved here from `cockpit.test.tsx` with the feature.
 *
 * A finished one-off run is an EVENT: it has a start time and never changes
 * again. It belongs on the Activity tab, not on a dashboard of what is
 * currently true. Moving the tests rather than rewriting them is deliberate —
 * these assertions were about the log's behaviour all along, and the only thing
 * that changed is which surface mounts it.
 *
 * Driven through `useRunLog` exactly as the Activity tab does, so the fetch,
 * the live-store merge, and the failure path stay covered end to end. Testing
 * `RunLog` alone with a props array would have quietly dropped the half of
 * these that are about where the runs COME from.
 */

const NOW = Date.now();

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 'r1',
    goalId: null,
    trigger: 'chat',
    status: 'succeeded',
    startedAt: NOW - 60_000,
    endedAt: NOW - 58_000,
    durationMs: 2_000,
    deliverables: [],
    ...over,
  }) as Run;

const fetchMock = vi.fn();

function serveRuns(runs: Run[]) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ runs, summary: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** What the Activity tab does, in one component. */
function ActivityRunLog() {
  const { runs, now, loading } = useRunLog();
  return <RunLog runs={runs} now={now} loading={loading} />;
}

beforeEach(() => {
  fetchMock.mockReset();
  serveRuns([]);
  vi.stubGlobal('fetch', fetchMock);
  useRunStore.setState({ goals: [], runs: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the run log on the Activity tab', () => {
  it('shows an empty state before anything exists', async () => {
    render(<ActivityRunLog />);
    await waitFor(() => expect(screen.getByText(/No runs recorded yet/i)).toBeTruthy());
  });

  // The core promise: runs from the durable log appear even though the client
  // store is empty — i.e. work done while the window was closed is visible.
  it('renders runs from the durable log, not just the session store', async () => {
    serveRuns([run({ id: 'from-disk' })]);
    render(<ActivityRunLog />);
    await waitFor(() => expect(screen.getAllByText('Succeeded').length).toBeGreaterThan(0));
    expect(useRunStore.getState().runs).toHaveLength(0); // proves it came from the log
  });

  it('expands a failed run to reveal its error', async () => {
    serveRuns([run({ id: 'bad', status: 'failed', error: 'upstream 502' })]);
    render(<ActivityRunLog />);
    await waitFor(() => expect(screen.getAllByText('Failed').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Failed').closest('button')!);
    expect(await screen.findByText('upstream 502')).toBeTruthy();
  });

  it('survives the log being unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<ActivityRunLog />);
    await waitFor(() => expect(screen.getByText(/No runs recorded yet/i)).toBeTruthy());
  });

  it('shows a clean-but-unmet run as "Ran, but unmet", not as a success', async () => {
    serveRuns([
      run({
        id: 'unmet',
        status: 'succeeded',
        verification: { passed: false, note: 'no message was posted' },
      }),
    ]);
    render(<ActivityRunLog />);
    expect(await screen.findByText('Ran, but unmet')).toBeTruthy();
    expect(screen.queryByText('Succeeded')).toBeNull();
  });

  it('reveals the verifier reasoning when expanded', async () => {
    serveRuns([
      run({
        id: 'unmet',
        status: 'succeeded',
        verification: { passed: false, note: 'no message was posted' },
      }),
    ]);
    render(<ActivityRunLog />);
    fireEvent.click((await screen.findByText('Ran, but unmet')).closest('button')!);
    expect(await screen.findByText(/Criteria not met: no message was posted/i)).toBeTruthy();
  });

  it('labels a verified run as Verified', async () => {
    serveRuns([run({ id: 'ok', verification: { passed: true, note: 'found it' } })]);
    render(<ActivityRunLog />);
    expect(await screen.findByText('Verified')).toBeTruthy();
  });

  it('merges an in-flight run from the store over the log', async () => {
    /*
     * The durable log only has completed runs, so a run happening right now
     * exists nowhere else. Without the merge the Activity tab would show
     * nothing until it finished.
     */
    serveRuns([]);
    useRunStore.setState({
      goals: [],
      runs: [run({ id: 'live', status: 'running', durationMs: undefined, endedAt: undefined })],
    });
    render(<ActivityRunLog />);
    expect(await screen.findByText('Running')).toBeTruthy();
  });
});
