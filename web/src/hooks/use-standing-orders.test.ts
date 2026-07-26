// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeOrder } from './use-standing-orders';
import { useAssistantStore, type StandingOrder } from '@/stores/assistant-store';
import { useRunStore } from '@/stores/run-store';

/**
 * executeOrder is where scheduled work actually happens, so it carries the
 * P6 wiring: every execution records a Run, and the completion condition is
 * judged by the verifier instead of the old keyword hack (where any output
 * containing the word "done" completed the order).
 */

const order = (over: Partial<StandingOrder> = {}): StandingOrder => ({
  id: 'o1',
  instruction: 'Watch AAPL and report when it crosses $200',
  trigger: { type: 'interval', expression: '30m' },
  state: {},
  status: 'active',
  notifyVia: 'assistant',
  runCount: 0,
  errorCount: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/** SSE body for the /api/chat/assistant call. */
function sse(text: string, usage?: object): Response {
  const frames = [
    `data: ${JSON.stringify({ type: 'text', content: text })}\n\n`,
    `data: ${JSON.stringify({ type: 'done', usage: usage ?? { inputTokens: 50, outputTokens: 80, cost: 0.004 } })}\n\n`,
  ].join('');
  return new Response(new TextEncoder().encode(frames), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const fetchMock = vi.fn();

/** Route the three endpoints executeOrder touches. */
function routeFetch(opts: { chatText: string; verify?: { passed: boolean } | 'error' }) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/chat/assistant')) return sse(opts.chatText);
    if (u.includes('/api/runs/verify')) {
      if (opts.verify === 'error') throw new Error('verifier down');
      return new Response(JSON.stringify({ verification: opts.verify ?? null, decision: { action: 'none' } }), { status: 200 });
    }
    if (u.includes('/api/runs')) return new Response('{"ok":true}', { status: 200 });
    return new Response('{}', { status: 200 });
  });
}

const verifyCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/runs/verify'));
const runPosts = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/api/runs') && !String(c[0]).includes('verify'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string).run);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useRunStore.setState({ goals: [], runs: [] });
  useAssistantStore.setState({ orders: [], cards: [], activity: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe('executeOrder — run recording', () => {
  it('records a succeeded run with cost against the order-goal', async () => {
    const o = order();
    useAssistantStore.setState({ orders: [o] });
    routeFetch({ chatText: 'AAPL is at $187 — nothing to report.' });

    await executeOrder(o);

    const runs = useRunStore.getState().runsForGoal('so:o1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'succeeded', trigger: 'cron', surfaceId: 'assistant' });
    expect(runs[0].cost).toEqual({ inputTokens: 50, outputTokens: 80, totalUsd: 0.004 });

    // and it lands in the durable log
    expect(runPosts()).toHaveLength(1);
    expect(runPosts()[0].goalId).toBe('so:o1');
  });

  it('records a failed run when the API errors, then rethrows', async () => {
    const o = order();
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/chat/assistant')) return new Response('nope', { status: 500, statusText: 'boom' });
      return new Response('{"ok":true}', { status: 200 });
    });

    await expect(executeOrder(o)).rejects.toThrow(/500/);
    const runs = useRunStore.getState().runsForGoal('so:o1');
    expect(runs[0]).toMatchObject({ status: 'failed' });
    expect(runs[0].error).toMatch(/500/);
  });

  it('records an empty response as a failed run', async () => {
    const o = order();
    routeFetch({ chatText: '   ' });
    await expect(executeOrder(o)).rejects.toThrow(/Empty response/);
    expect(useRunStore.getState().runsForGoal('so:o1')[0].status).toBe('failed');
  });
});

describe('executeOrder — completion via verification (the keyword hack is dead)', () => {
  it('does NOT complete just because the output contains the word "done"', async () => {
    const o = order({ completionCondition: 'AAPL crossed $200' });
    useAssistantStore.setState({ orders: [o] });
    // The old code would have completed here: output contains "done".
    routeFetch({ chatText: 'Checked the price — nothing done yet, AAPL is at $185.', verify: { passed: false } });

    await executeOrder(o);

    expect(useAssistantStore.getState().getOrder('o1')?.status).toBe('active');
    expect(verifyCalls()).toHaveLength(1);
  });

  it('completes when the verifier confirms the condition', async () => {
    const o = order({ completionCondition: 'AAPL crossed $200' });
    useAssistantStore.setState({ orders: [o] });
    routeFetch({ chatText: 'AAPL just hit $201.30.', verify: { passed: true } });

    await executeOrder(o);

    expect(useAssistantStore.getState().getOrder('o1')?.status).toBe('completed');
  });

  it('frames the check as a completion question and does not persist the verdict', async () => {
    const o = order({ completionCondition: 'AAPL crossed $200' });
    useAssistantStore.setState({ orders: [o] });
    routeFetch({ chatText: 'AAPL at $201.', verify: { passed: true } });

    await executeOrder(o);

    const body = JSON.parse((verifyCalls()[0][1] as RequestInit).body as string);
    expect(body.goal.successCriteria).toContain('completion condition has now been met');
    expect(body.persist).toBe(false); // a stop-condition check must not grade the run
    expect(body.outputSummary).toContain('AAPL at $201');
  });

  // False positive silently kills the order; false negative just keeps watching.
  it('fails closed — a broken verifier never completes the order', async () => {
    const o = order({ completionCondition: 'AAPL crossed $200' });
    useAssistantStore.setState({ orders: [o] });
    routeFetch({ chatText: 'AAPL at $205 — condition met!', verify: 'error' });

    await executeOrder(o);

    expect(useAssistantStore.getState().getOrder('o1')?.status).toBe('active');
  });

  it('skips verification entirely when there is no completion condition', async () => {
    const o = order();
    useAssistantStore.setState({ orders: [o] });
    routeFetch({ chatText: 'All done and completed!' }); // keywords must be inert

    await executeOrder(o);

    expect(verifyCalls()).toHaveLength(0);
    expect(useAssistantStore.getState().getOrder('o1')?.status).toBe('active');
  });
});
