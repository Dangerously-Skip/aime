// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Cockpit } from './cockpit';
import { useRunStore } from '@/stores/run-store';
import { useAssistantStore } from '@/stores/assistant-store';
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
  useAssistantStore.setState({ orders: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Cockpit', () => {
  it('shows an empty state before anything exists', async () => {
    render(<Cockpit />);
    expect(await screen.findByText(/No goals yet/i)).toBeTruthy();
  });

  /*
   * The ad-hoc run log — its empty state, its rows, expansion, and the
   * unmet/verified labels — moved to `run-log.test.tsx` with the feature. A
   * finished one-off run is an event and lives on the Activity tab now; what
   * stays here is what the Cockpit still claims: goals, their health, and the
   * spend total in the header.
   */

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

  // Standing orders are already goals; the Cockpit must reflect what the user
  // has set up rather than showing an empty dashboard beside a full order list.
  it('adapts standing orders into scheduled work', async () => {
    useAssistantStore.setState({
      orders: [
        {
          id: 'o1',
          instruction: 'Watch main for build failures',
          trigger: { type: 'cron', expression: '0 9 * * *' },
          state: {},
          status: 'active',
          notifyVia: 'assistant',
          runCount: 0,
          errorCount: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    render(<Cockpit />);
    expect(await screen.findByText('Watch main for build failures')).toBeTruthy();
    expect(screen.getByText('0 9 * * *')).toBeTruthy();
    expect(screen.queryByText(/No goals yet/i)).toBeNull();
  });

  it('shows pre-tracking history as context without inventing a success rate', async () => {
    useAssistantStore.setState({
      orders: [
        {
          id: 'o2',
          instruction: 'Nightly digest',
          trigger: { type: 'interval', expression: '1d' },
          state: {},
          status: 'active',
          notifyVia: 'assistant',
          runCount: 41,
          errorCount: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    render(<Cockpit />);
    // 41 prior executions are surfaced...
    expect(await screen.findByText(/41 before tracking/i)).toBeTruthy();
    // ...but a lifetime error count must NOT read as currently failing.
    expect(screen.queryByText(/Failing/i)).toBeNull();
    expect(screen.getByText(/No runs yet/i)).toBeTruthy();
  });

  it('does not show a paused order as scheduled', async () => {
    useAssistantStore.setState({
      orders: [
        {
          id: 'o3',
          instruction: 'Paused thing',
          trigger: { type: 'cron', expression: '0 9 * * *' },
          state: {},
          status: 'paused',
          notifyVia: 'assistant',
          runCount: 0,
          errorCount: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    });
    render(<Cockpit />);
    const dot = await screen.findByTitle('Paused');
    expect(dot).toBeTruthy();
  });

  // A goal whose latest run achieved nothing must not read as healthy.
  it('treats a goal whose latest run was unmet as failing', async () => {
    useRunStore.setState({ goals: [goal()] });
    serveRuns([run({ id: 'u', status: 'succeeded', verification: { passed: false } })]);
    render(<Cockpit />);
    await waitFor(() => expect(screen.getByText(/^1 failing$/i)).toBeTruthy());
    expect(screen.queryByText(/Healthy/i)).toBeNull();
  });
});
