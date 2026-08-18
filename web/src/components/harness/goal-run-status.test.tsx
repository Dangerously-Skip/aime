// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { GoalRunStatus } from './goal-run-status';

/**
 * The gap between pressing send and seeing anything.
 *
 * Planning is a full model call — thirty seconds or more. Until this existed the
 * screen showed nothing at all during it: the send button went quiet and the
 * panel appeared a minute later, which reads as nothing having happened.
 */
vi.mock('./goal-panel', () => ({ GoalPanel: () => <div>STATUS PANEL</div> }));

const noGoal = () => vi.fn(async () => ({ ok: true, json: async () => ({ goal: null }) })) as unknown as typeof fetch;
const hasGoal = () => vi.fn(async () => ({ ok: true, json: async () => ({ goal: { objective: 'x' } }) })) as unknown as typeof fetch;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('GoalRunStatus', () => {
  it('says it is PLANNING, straight away, with the objective', async () => {
    global.fetch = noGoal();
    render(
      <GoalRunStatus
        chatId="c1" folder="/tmp/p" surfaceId="cowork"
        starting={{ objective: 'Make ./check.sh pass', phase: 'planning' }}
      />,
    );
    expect(screen.getByText(/Working out a plan/i)).toBeTruthy();
    expect(screen.getByText('Make ./check.sh pass')).toBeTruthy();
    // And says why it is taking a moment, rather than just spinning.
    expect(screen.getByText(/breaking this into checkable steps/i)).toBeTruthy();
  });

  it('distinguishes starting from planning', () => {
    global.fetch = noGoal();
    render(
      <GoalRunStatus
        chatId="c1" folder="/tmp/p" surfaceId="cowork"
        starting={{ objective: 'x', phase: 'starting' }}
      />,
    );
    expect(screen.getByText(/Starting…/)).toBeTruthy();
  });

  it('renders nothing when idle with no goal — ordinary chat is untouched', async () => {
    global.fetch = noGoal();
    const { container } = render(<GoalRunStatus chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('hands over to the real panel once the goal exists', async () => {
    global.fetch = hasGoal();
    render(
      <GoalRunStatus
        chatId="c1" folder="/tmp/p" surfaceId="cowork"
        starting={{ objective: 'x', phase: 'planning' }}
      />,
    );
    // The pending card must not linger over a run that has actually begun.
    await waitFor(() => expect(screen.getByText('STATUS PANEL')).toBeTruthy());
    expect(screen.queryByText(/Working out a plan/i)).toBeNull();
  });

  it('re-checks immediately when nudged, rather than waiting for the poll', async () => {
    const fetchMock = hasGoal();
    global.fetch = fetchMock;
    const { rerender } = render(<GoalRunStatus chatId="c1" folder="/tmp/p" surfaceId="cowork" nudge={0} />);
    await waitFor(() => expect(screen.getByText('STATUS PANEL')).toBeTruthy());
    const before = (fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    rerender(<GoalRunStatus chatId="c1" folder="/tmp/p" surfaceId="cowork" nudge={1} />);
    await waitFor(() =>
      expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(before),
    );
  });
});
