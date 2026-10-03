// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { Cockpit } from './cockpit';
import { APP_NAME } from '@/config/branding';
import { useRunStore } from '@/stores/run-store';
import { useAssistantStore } from '@/stores/assistant-store';
import type { Goal, Run } from '@/lib/runs/types';
import { approvalPolicyLabel } from '@/lib/runs/format';

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

let manifestOrders: unknown[] = [];

/** Serve the durable log (and the order manifest the attended jobs come from). */
function serveRuns(runs: Run[]) {
  fetchMock.mockImplementation(async (url: string) =>
    new Response(JSON.stringify(url.startsWith('/api/schedule/orders') ? { orders: manifestOrders } : { runs, summary: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  manifestOrders = [];
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
    // "Schedules", not "goals": the Code/Cowork harness has an unrelated Goal mode.
    expect(await screen.findByText(/No schedules yet/i)).toBeTruthy();
    expect(screen.queryByText(/goal/i)).toBeNull();
    // addGoal has no caller, so the copy must not promise scheduled widgets here.
    expect(screen.queryByText(/scheduled widgets/i)).toBeNull();
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
    // In words, with a next run — not the raw cron it was saved as.
    expect(screen.getByText('Every day at 9:00 AM')).toBeTruthy();
    expect(screen.queryByText('0 9 * * *')).toBeNull();
    expect(screen.getByText(/^Next in /)).toBeTruthy();
    expect(screen.getByText('Runs in background')).toBeTruthy();
    expect(screen.queryByText(/No schedules yet/i)).toBeNull();
  });

  /*
   * What a background order may do, as ENFORCED. The code and this screen once
   * said standing orders "pause before side effects"; nothing paused anything,
   * and nothing was refused either. The label is now the policy the executor
   * passes to the provider, and it says "refused".
   */
  it('says what a standing order may do — refused, not paused', async () => {
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
    const label = await screen.findByText(approvalPolicyLabel('consequential'));
    expect(label.textContent).toMatch(/refused/);
    expect(document.body.textContent).not.toMatch(/paus(e|es) before/i);
  });

  it("lists a run's refused steps — the tool and the reason", async () => {
    useRunStore.setState({ goals: [goal({ id: 'so:o9', approvalPolicy: 'consequential' })] });
    serveRuns([
      run({
        id: 'refused',
        goalId: 'so:o9',
        refusals: [
          { tool: 'Write', reason: 'Unattended run: has effects outside the app', at: NOW - 59_000 },
          { tool: 'Bash', reason: 'Block dangerous commands: a recursive delete, and nobody was there to ask', at: NOW - 59_000 },
        ],
      }),
    ]);
    render(<Cockpit />);
    fireEvent.click(await screen.findByRole('button', { name: 'View runs' }));
    const row = (await screen.findByText('2 steps refused')).closest('button')!;
    fireEvent.click(row);
    const list = await screen.findByRole('list', { name: 'Refused steps' });
    expect(within(list).getByText('Write')).toBeTruthy();
    expect(within(list).getByText(/has effects outside the app/)).toBeTruthy();
    expect(within(list).getByText(/^Bash$/)).toBeTruthy();
    expect(screen.getByText(/will not run later/)).toBeTruthy();
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

describe('Cockpit — attended jobs', () => {
  it('lists jobs that need the window open, labelled as such', async () => {
    manifestOrders = [
      {
        id: 'j1',
        instruction: 'Open Browser and check my watchlist',
        attended: true,
        surfaceId: 'browser',
        trigger: { type: 'cron', expression: '0 9 * * MON-FRI' },
        status: 'active',
        runCount: 3,
        lastRun: NOW - 3_600_000,
        createdAt: 0,
      },
      // Unattended manifest entries are the server's and appear via the store.
      { id: 'srv', instruction: 'server one', trigger: { type: 'interval', expression: '1h' }, status: 'active', runCount: 0 },
    ];
    serveRuns([]);
    render(<Cockpit />);
    expect(await screen.findByText('Open Browser and check my watchlist')).toBeTruthy();
    expect(screen.getByText(`Needs ${APP_NAME} open`)).toBeTruthy();
    // It runs as a chat turn, so that is what it says — not 'consequential',
    // which it carried while nothing enforced it.
    expect(screen.getByText(approvalPolicyLabel('never'))).toBeTruthy();
    expect(screen.getByText('Weekdays at 9:00 AM')).toBeTruthy();
    expect(screen.getByText('Last ran 1h ago')).toBeTruthy();
    expect(screen.queryByText('server one')).toBeNull();
  });
});
