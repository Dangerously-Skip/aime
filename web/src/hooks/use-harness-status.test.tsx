// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { VoiceScope } from '@/lib/voice/voice-scope';
import { useAppStore } from '@/stores/app-store';
import { GoalQuestion } from '@/components/harness/goal-question';
import { GoalRunStatus } from '@/components/harness/goal-run-status';
import { GoalPanel } from '@/components/harness/goal-panel';
import { useGoalTranscript } from '@/components/harness/use-goal-transcript';
import { useGoalAutoOpen } from '@/components/harness/use-goal-autoopen';
import { ACTIVE_POLL_MS, IDLE_POLL_MS, resetHarnessStatusForTests } from './use-harness-status';

/**
 * FIVE POLLERS, ONE REQUEST.
 *
 * The question card (2s), the goal panel (2s), the run status (3s), the
 * transcript narrator (3s) and the auto-opener (5s) each polled /api/harness on
 * their own — on Code and Cowork, hidden or not, window focused or not, goal or
 * no goal. These mount the REAL five consumers and count requests.
 */

vi.mock('@/hooks/use-builtin-access', () => ({
  useBuiltinAccess: () => ({ hasAnthropicKey: true, hasBedrock: false, known: true }),
}));

const CHAT = 'c1';
const DIR = '/tmp/ws';
let running = true;
let goal: object | null = { objective: 'ship it' };
const fetchMock = vi.fn(async (url: string) => ({
  ok: true,
  json: async () => ({ running, goal, ledger: null, run: null, decision: null, events: [], question: null, url }),
}));

/** Requests to the status endpoint only (the panel's other calls are not polls). */
const polls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/harness?')).length;

function AllFive({ chatId = CHAT }: { chatId?: string }) {
  useGoalTranscript(chatId, DIR, () => {});
  useGoalAutoOpen(chatId, DIR);
  return (
    <>
      <GoalQuestion chatId={chatId} folder={DIR} surfaceId="code" />
      <GoalRunStatus chatId={chatId} folder={DIR} surfaceId="code" />
      <GoalPanel conversationId={chatId} workingDir={DIR} surfaceId="code" />
    </>
  );
}

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetHarnessStatusForTests();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  running = true;
  goal = { objective: 'ship it' };
  setVisibility('visible');
  useAppStore.setState({ activeSurface: 'code', sidebarMode: 'history' } as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('one shared poll', () => {
  it('five consumers make ONE request per tick', async () => {
    render(<AllFive />);
    await flush();
    expect(polls()).toBe(1);
    await advance(ACTIVE_POLL_MS);
    await flush();
    expect(polls()).toBe(2);
    await advance(ACTIVE_POLL_MS * 5);
    await flush();
    expect(polls()).toBe(7);
  });

  it('separate conversations are polled separately', async () => {
    render(<><AllFive chatId="a" /><AllFive chatId="b" /></>);
    await flush();
    expect(polls()).toBe(2);
  });
});

describe('backs off when nothing is running', () => {
  it('no goal → one check, then only every IDLE_POLL_MS', async () => {
    goal = null;
    running = false;
    render(<AllFive />);
    await flush();
    expect(polls()).toBe(1);
    await advance(IDLE_POLL_MS - 1000);
    expect(polls()).toBe(1);
    await advance(1000);
    await flush();
    expect(polls()).toBe(2);
  });

  it('a run that stops drops to the idle cadence', async () => {
    render(<AllFive />);
    await flush();
    running = false;
    await advance(ACTIVE_POLL_MS);
    await flush();
    const n = polls();
    await advance(ACTIVE_POLL_MS * 10);
    expect(polls()).toBe(n);
  });
});

describe('pauses when nobody can see it', () => {
  it('a hidden surface does not poll, and fetches as soon as it is shown', async () => {
    useAppStore.setState({ activeSurface: 'chat' } as never);
    render(<VoiceScope id="code" active={false}><AllFive /></VoiceScope>);
    await flush();
    await advance(ACTIVE_POLL_MS * 10);
    expect(polls()).toBe(0);

    act(() => useAppStore.setState({ activeSurface: 'code' } as never));
    await flush();
    expect(polls()).toBe(1);
  });

  it('a hidden window stops polling; returning refetches', async () => {
    render(<AllFive />);
    await flush();
    expect(polls()).toBe(1);
    act(() => setVisibility('hidden'));
    await advance(ACTIVE_POLL_MS * 10);
    expect(polls()).toBe(1);
    act(() => setVisibility('visible'));
    await flush();
    expect(polls()).toBe(2);
  });

  it('unmounting everything stops the timer', async () => {
    const { unmount } = render(<AllFive />);
    await flush();
    unmount();
    await advance(ACTIVE_POLL_MS * 10);
    expect(polls()).toBe(1);
  });
});
