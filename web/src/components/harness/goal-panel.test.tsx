// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { GoalPanel, type HarnessStatus } from './goal-panel';

/**
 * The panel is the run's only account of itself.
 *
 * Two things it must never do quietly: show a task as done when nothing checked
 * it, and show a run as fine when it stopped needing help.
 */
const status = (over: Partial<HarnessStatus> = {}): HarnessStatus => ({
  running: true,
  goal: {
    version: 1,
    objective: 'Make every embed play',
    acceptanceCriteria: [],
    budgetUsd: 5,
    deadlineIso: null,
    sessionCap: 20,
    createdAt: '',
  },
  ledger: {
    version: 1,
    tasks: [
      { id: 't-1', title: 'Serve over http', verify: [], status: 'passed', attempts: 1, lastVerdict: null },
      { id: 't-2', title: 'Fix the layout', verify: [], status: 'doing', attempts: 3, lastVerdict: null },
      { id: 't-3', title: 'Add a test', verify: [], status: 'todo', attempts: 0, lastVerdict: null },
    ],
  },
  run: { sessions: 4, spentUsd: 1.234, startedAtMs: 0, idleSessions: 0, lastStateHash: 'h' },
  decision: null,
  events: [],
  ...over,
});

function mockFetch(body: HarnessStatus) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  // This repo does not auto-cleanup between jsdom tests, so without this a
  // later `queryByText(...).toBeNull()` finds an element from an earlier render
  // and the assertion is about the wrong DOM entirely.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GoalPanel', () => {
  it('shows the plan, the count and the spend against budget', async () => {
    global.fetch = mockFetch(status());
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);

    await waitFor(() => expect(screen.getByText('Make every embed play')).toBeTruthy());
    expect(screen.getByText(/1 of 3 passed/)).toBeTruthy();
    expect(screen.getByText(/\$1\.23 of \$5\.00/)).toBeTruthy();
    expect(screen.getByText(/4 sessions/)).toBeTruthy();
  });

  it('marks a pass with no verdict as UNVERIFIED', async () => {
    /*
     * Phase 1 has no verifier, so a pass is the session's own claim. This app
     * has already told a user nine videos were embedded when none of them
     * played; the label is the difference between that and honesty.
     */
    global.fetch = mockFetch(status());
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('unverified')).toBeTruthy());
  });

  it('does NOT label a pass unverified once a verdict exists', async () => {
    const s = status();
    s.ledger!.tasks[0].lastVerdict = { passed: true, missing: [], evidence: ['curl → 200'], at: 'now' };
    global.fetch = mockFetch(s);
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Serve over http')).toBeTruthy());
    expect(screen.queryByText('unverified')).toBeNull();
  });

  it('shows repeated attempts, so a task grinding is visible', async () => {
    global.fetch = mockFetch(status());
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('3 attempts')).toBeTruthy());
  });

  it('flags an ending that needs a human, and says it will not restart', async () => {
    global.fetch = mockFetch(
      status({
        running: false,
        decision: { stop: true, reason: 'no-progress', detail: '3 sessions in a row moved nothing.' },
      }),
    );
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText(/moved nothing/)).toBeTruthy());
    expect(screen.getByText(/needs you/i)).toBeTruthy();
    expect(screen.getByText(/will not restart/i)).toBeTruthy();
  });

  it('does not cry wolf on an ordinary ending', async () => {
    global.fetch = mockFetch(
      status({ running: false, decision: { stop: true, reason: 'complete', detail: 'All 3 tasks passed.' } }),
    );
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText(/All 3 tasks passed/)).toBeTruthy());
    expect(screen.queryByText(/needs you/i)).toBeNull();
  });

  it('surfaces a rejected plan edit prominently', async () => {
    global.fetch = mockFetch(
      status({ events: [{ type: 'tamper', sessionIndex: 2, detail: 'task t-3 was removed' }] }),
    );
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText(/rejected plan edit/)).toBeTruthy());
    expect(screen.getByText(/t-3 was removed/)).toBeTruthy();
  });

  it('offers a stop only while running', async () => {
    global.fetch = mockFetch(status());
    const { unmount } = render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /stop/i })).toBeTruthy());
    unmount();

    global.fetch = mockFetch(status({ running: false }));
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Make every embed play')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
  });

  it('asks for a folder before anything else', () => {
    global.fetch = mockFetch(status());
    render(<GoalPanel conversationId="c1" workingDir={null} surfaceId="code" />);
    expect(screen.getByText(/Pick a folder/i)).toBeTruthy();
  });

  it('renders NOTHING when there is no goal', async () => {
    /*
     * It offered a start form once, which became a second composer under the
     * real one — the same sentence typed into two boxes to do one thing.
     * Starting is the composer's own toggle now; this only reports.
     */
    global.fetch = mockFetch(status({ goal: null, ledger: null, run: null }));
    const { container } = render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('GoalPanel — verification', () => {
  it('labels a verified pass, and does not call it unverified', async () => {
    const s = status();
    s.ledger!.tasks[0].lastVerdict = { passed: true, missing: [], evidence: ['curl → 200'], at: 'now' };
    global.fetch = mockFetch(s);
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('verified')).toBeTruthy());
    expect(screen.queryByText('unverified')).toBeNull();
  });

  it('shows WHY a task keeps failing, in the verifier’s own words', async () => {
    /*
     * Without this a task grinding through attempts looks like bad luck rather
     * than one specific, repeated, readable failure.
     */
    const s = status();
    s.ledger!.tasks[1].lastVerdict = {
      passed: false,
      missing: ['step 2 fails: the iframe returns Error 153'],
      evidence: ['opened slide 3'],
      at: 'now',
    };
    global.fetch = mockFetch(s);
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText(/Error 153/)).toBeTruthy());
  });

  it('does not show a stale rejection on a task that has since passed', async () => {
    const s = status();
    s.ledger!.tasks[0].lastVerdict = { passed: false, missing: ['old failure'], evidence: [], at: 'now' };
    s.ledger!.tasks[0].status = 'passed';
    global.fetch = mockFetch(s);
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Serve over http')).toBeTruthy());
    expect(screen.queryByText('old failure')).toBeNull();
  });
});

describe('GoalPanel — a parked question', () => {
  const parked = {
    id: 'q1', taskId: 't-2', question: 'Postgres or SQLite?',
    options: ['Postgres', 'SQLite'], context: 'The schema differs.',
    askedAt: 'now', answer: null, answeredAt: null,
  };

  it('shows the question and how to answer it', async () => {
    global.fetch = mockFetch(status({ running: false, question: parked }));
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Postgres or SQLite?')).toBeTruthy());
    expect(screen.getByText(/needs a decision from you/i)).toBeTruthy();
    expect(screen.getByText('The schema differs.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Postgres' })).toBeTruthy();
  });

  it('shows the question INSTEAD of the stop reason', async () => {
    /*
     * A run waiting on a decision is neither broken nor finished. Burying the
     * question among stop reasons would hide the one thing that unblocks it.
     */
    global.fetch = mockFetch(
      status({
        running: false,
        question: parked,
        decision: { stop: true, reason: 'awaiting-answer', detail: 'Waiting on your answer.' },
      }),
    );
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Postgres or SQLite?')).toBeTruthy());
    expect(screen.queryByText(/Waiting on your answer\./)).toBeNull();
  });

  it('POSTs the answer with the question id', async () => {
    // The id is what stops a stale panel answering a question the user never saw.
    const posted: Record<string, unknown>[] = [];
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posted.push(JSON.parse(String(init.body))); return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: true, json: async () => status({ running: false, question: parked }) };
    }) as unknown as typeof fetch;

    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'SQLite' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'SQLite' }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]).toMatchObject({ id: 'q1', answer: 'SQLite' });
  });

  it('shows no question box when there is none', async () => {
    global.fetch = mockFetch(status());
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Make every embed play')).toBeTruthy());
    expect(screen.queryByText(/needs a decision from you/i)).toBeNull();
  });
});

describe('GoalPanel — starting another', () => {
  it('says how to start another once a run has finished', async () => {
    /*
     * "How do I add a new goal?" had no answer on screen: a finished run
     * occupied the panel and there was no affordance at all. A goal is per
     * conversation, so a new chat is the answer — and saying so beats a button
     * that would have to discard this run's ledger and progress log.
     */
    global.fetch = mockFetch(
      status({ running: false, decision: { stop: true, reason: 'complete', detail: 'All done.' } }),
    );
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText(/Start a new chat on this folder/i)).toBeTruthy());
  });

  it('does not suggest it while the run is still going', async () => {
    global.fetch = mockFetch(status({ running: true }));
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Make every embed play')).toBeTruthy());
    expect(screen.queryByText(/Start a new chat/i)).toBeNull();
  });

  it('does not suggest it while a question is waiting', async () => {
    // The question is the only thing to act on; anything else is a distraction.
    global.fetch = mockFetch(
      status({
        running: false,
        question: { id: 'q1', taskId: null, question: 'Which?', options: [], context: '', askedAt: '', answer: null, answeredAt: null },
      }),
    );
    render(<GoalPanel conversationId="c1" workingDir="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('Which?')).toBeTruthy());
    expect(screen.queryByText(/Start a new chat/i)).toBeNull();
  });
});
