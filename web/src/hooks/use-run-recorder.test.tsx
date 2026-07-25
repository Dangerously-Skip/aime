// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRunRecorder } from './use-run-recorder';
import { useRunStore } from '@/stores/run-store';
import type { StreamUsage } from './use-sse-stream';

const usage = (over: Partial<StreamUsage> = {}): StreamUsage => ({
  inputTokens: 120,
  outputTokens: 340,
  cost: 0.0123,
  model: 'sonnet',
  durationMs: 2_500,
  toolCallCount: 4,
  ...over,
});

const runs = () => useRunStore.getState().runs;

const fetchMock = vi.fn();
/** Run records POSTed to the durable JSONL log. */
const persisted = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/api/runs'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string).run);

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  useRunStore.setState({ goals: [], runs: [] });
  let n = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
    () => `run-${++n}` as `${string}-${string}-${string}-${string}-${string}`,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useRunRecorder', () => {
  it('records a successful turn with cost and tool count from usage', () => {
    const { result } = renderHook(() => useRunRecorder('chat'));
    result.current.begin({ trigger: 'chat', model: 'sonnet' });
    result.current.onUsage(usage());
    result.current.succeed();

    expect(runs()).toHaveLength(1);
    const run = runs()[0];
    expect(run).toMatchObject({
      status: 'succeeded',
      trigger: 'chat',
      surfaceId: 'chat',
      model: 'sonnet',
      goalId: null,
      toolCalls: 4,
    });
    // The cost attribution that makes the whole substrate worthwhile.
    expect(run.cost).toEqual({ inputTokens: 120, outputTokens: 340, totalUsd: 0.0123 });
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failure with its message', () => {
    const { result } = renderHook(() => useRunRecorder('cowork'));
    result.current.begin({ trigger: 'cron', goalId: 'g1' });
    result.current.fail('upstream 502');

    expect(runs()[0]).toMatchObject({ status: 'failed', error: 'upstream 502', goalId: 'g1', trigger: 'cron' });
  });

  it('records a run with no usage rather than dropping it', () => {
    const { result } = renderHook(() => useRunRecorder('chat'));
    result.current.begin({ trigger: 'chat' });
    result.current.succeed(); // usage never arrived
    expect(runs()[0]).toMatchObject({ status: 'succeeded' });
    expect(runs()[0].cost).toBeUndefined();
  });

  // Recording must never break the turn it measures.
  it('is safe to finish twice, or without ever beginning', () => {
    const { result } = renderHook(() => useRunRecorder('chat'));
    expect(() => result.current.succeed()).not.toThrow();
    expect(runs()).toHaveLength(0);

    result.current.begin({ trigger: 'chat' });
    result.current.succeed();
    expect(() => result.current.fail('late error')).not.toThrow();
    // the second call must not flip the recorded outcome
    expect(runs()[0].status).toBe('succeeded');
    expect(runs()).toHaveLength(1);
  });

  it('does not leak usage from a previous turn into the next', () => {
    const { result } = renderHook(() => useRunRecorder('chat'));
    result.current.begin({ trigger: 'chat' });
    result.current.onUsage(usage({ cost: 9.99 }));
    result.current.succeed();

    result.current.begin({ trigger: 'chat' });
    result.current.succeed();

    const [second, first] = runs(); // newest first
    expect(first.cost?.totalUsd).toBe(9.99);
    expect(second.cost).toBeUndefined();
  });

  it('an aborted turn records as cancelled, not failed', () => {
    const { result } = renderHook(() => useRunRecorder('code'));
    result.current.begin({ trigger: 'manual' });
    result.current.cancel();
    expect(runs()[0].status).toBe('cancelled');
  });

  it('folds a goal-attributed run onto its goal', () => {
    useRunStore.getState().addGoal({
      id: 'g1',
      objective: 'nightly digest',
      approvalPolicy: 'never',
      enabled: true,
      createdAt: 0,
      consecutiveFailures: 2,
    });
    const { result } = renderHook(() => useRunRecorder('cowork'));
    result.current.begin({ trigger: 'cron', goalId: 'g1' });
    result.current.succeed();

    expect(useRunStore.getState().getGoal('g1')?.consecutiveFailures).toBe(0);
    expect(useRunStore.getState().summaryForGoal('g1').successRate).toBe(1);
  });

  it('persists the completed run to the durable log, with its cost', () => {
    const { result } = renderHook(() => useRunRecorder('chat'));
    result.current.begin({ trigger: 'chat', model: 'sonnet' });
    result.current.onUsage(usage());
    result.current.succeed();

    // The store window is for live display; THIS is the record that survives a
    // restart and shows work done while the window was closed.
    expect(persisted()).toHaveLength(1);
    expect(persisted()[0]).toMatchObject({
      status: 'succeeded',
      trigger: 'chat',
      cost: { inputTokens: 120, outputTokens: 340, totalUsd: 0.0123 },
    });
  });

  it('does not fail the turn when the durable write fails', async () => {
    fetchMock.mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() => useRunRecorder('chat'));
    result.current.begin({ trigger: 'chat' });
    expect(() => result.current.succeed()).not.toThrow();
    // the in-memory record still stands
    expect(runs()[0].status).toBe('succeeded');
  });

  it('writes once per run, not once per state change', () => {
    const { result } = renderHook(() => useRunRecorder('chat'));
    result.current.begin({ trigger: 'chat' });
    result.current.onUsage(usage());
    result.current.succeed();
    result.current.fail('late'); // already terminal — must not write again
    expect(persisted()).toHaveLength(1);
  });
});
