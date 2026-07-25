// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Cockpit } from './cockpit';
import { useRunStore } from '@/stores/run-store';
import type { Goal, Run } from '@/lib/runs/types';

const NOW = Date.now();

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  objective: 'Summarise overnight build failures',
  approvalPolicy: 'never',
  enabled: true,
  createdAt: 0,
  ...over,
});

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  goalId: 'g1',
  trigger: 'cron',
  status: 'succeeded',
  startedAt: NOW - 60_000,
  endedAt: NOW - 58_000,
  durationMs: 2_000,
  deliverables: [],
  ...over,
});

const fetchMock = vi.fn();

/** Serve the durable log. */
function serveRuns(runs: Run[]) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ runs, summary: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
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

describe('Cockpit', () => {
  it('shows empty states before anything exists', async () => {
    render(<Cockpit />);
    expect(await screen.findByText(/No goals yet/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/No runs recorded yet/i)).toBeTruthy());
  });

  // The core promise: runs from the durable log appear even though the client
  // store is empty — i.e. work done while the window was closed is visible.
  it('renders runs from the durable log, not just the session store', async () => {
    serveRuns([run({ id: 'from-disk', goalId: null, trigger: 'chat' })]);
    render(<Cockpit />);
    await waitFor(() => expect(screen.getAllByText('Succeeded').length).toBeGreaterThan(0));
    expect(useRunStore.getState().runs).toHaveLength(0); // proves it came from the log
  });

  it('surfaces total spend — the number the reference tools cannot show', async () => {
    serveRuns([
      run({ id: 'a', goalId: null, cost: { inputTokens: 10, outputTokens: 20, totalUsd: 0.02 } }),
      run({ id: 'b', goalId: null, cost: { inputTokens: 10, outputTokens: 20, totalUsd: 0.03 } }),
    ]);
    render(<Cockpit />);
    await waitFor(() => expect(screen.getByText(/\$0\.050 spent/)).toBeTruthy());
  });

  it('keeps sub-cent spend visible rather than rounding it to zero', async () => {
    serveRuns([run({ id: 'a', goalId: null, cost: { inputTokens: 1, outputTokens: 1, totalUsd: 0.0004 } })]);
    render(<Cockpit />);
    await waitFor(() => expect(screen.getByText(/\$0\.0004 spent/)).toBeTruthy());
  });

  it('names a failing goal instead of letting it look idle', async () => {
    useRunStore.setState({ goals: [goal()] });
    serveRuns([
      run({ id: 'f1', status: 'failed', startedAt: NOW - 120_000 }),
      run({ id: 'f2', status: 'failed', startedAt: NOW - 60_000, error: 'upstream 502' }),
    ]);
    render(<Cockpit />);
    // Note: /Failing/i alone matches the header's "1 failing" too, so assert on
    // the goal's own health sentence.
    await waitFor(() => expect(screen.getByText(/Failing — 2 failures/i)).toBeTruthy());
    // and the header counts it separately
    expect(screen.getByText(/^1 failing$/i)).toBeTruthy();
  });

  it('reports a healthy goal', async () => {
    useRunStore.setState({ goals: [goal()] });
    serveRuns([run({ id: 'ok' })]);
    render(<Cockpit />);
    await waitFor(() => expect(screen.getByText(/Healthy/i)).toBeTruthy());
  });

  it('shows an in-flight run from the store merged over the log', async () => {
    useRunStore.setState({
      goals: [],
      runs: [run({ id: 'live', goalId: null, status: 'running', durationMs: undefined, endedAt: undefined })],
    });
    serveRuns([]);
    render(<Cockpit />);
    await waitFor(() => expect(screen.getByText(/1 running/i)).toBeTruthy());
  });

  it('lets the live copy of a run win over the logged copy', async () => {
    // Same id in both: the store says running, the log says succeeded.
    serveRuns([run({ id: 'dup', goalId: null, status: 'succeeded' })]);
    useRunStore.setState({
      goals: [],
      runs: [run({ id: 'dup', goalId: null, status: 'running', durationMs: undefined })],
    });
    render(<Cockpit />);
    await waitFor(() => expect(screen.getByText(/1 running/i)).toBeTruthy());
    // counted once, not twice
    expect(screen.getByText(/^1 runs$/)).toBeTruthy();
  });

  it('expands a failed run to reveal its error', async () => {
    serveRuns([run({ id: 'bad', goalId: null, status: 'failed', error: 'upstream 502' })]);
    render(<Cockpit />);
    await waitFor(() => expect(screen.getAllByText('Failed').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Failed').closest('button')!);
    expect(await screen.findByText('upstream 502')).toBeTruthy();
  });

  it('survives the log being unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<Cockpit />);
    await waitFor(() => expect(screen.getByText(/No runs recorded yet/i)).toBeTruthy());
  });
});
