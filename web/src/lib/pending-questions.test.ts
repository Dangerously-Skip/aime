import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForAnswer, resolveAnswer, QUESTION_TIMEOUT_MS } from './pending-questions';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pending questions bridge', () => {
  it('resolves a waiting question with the provided answers', async () => {
    const pending = waitForAnswer('q1');
    expect(resolveAnswer('q1', { color: 'blue' })).toBe(true);
    await expect(pending).resolves.toEqual({ color: 'blue' });
  });

  it('returns false for unknown or already-resolved question ids', async () => {
    expect(resolveAnswer('never-asked', {})).toBe(false);

    const pending = waitForAnswer('q2');
    resolveAnswer('q2', {});
    await pending;
    expect(resolveAnswer('q2', {})).toBe(false);
  });

  it('times out after 4 minutes of no answer', async () => {
    const pending = waitForAnswer('q3');
    const assertion = expect(pending).rejects.toThrow('timed out');
    vi.advanceTimersByTime(240_001);
    await assertion;

    expect(resolveAnswer('q3', {})).toBe(false); // entry cleaned up
  });

  it('the park budget stays under every surface silence timer', () => {
    /*
     * While parked, nothing streams — so the route's silence timer keeps
     * running. The browser surface's budget is 300s; a park cap at or above it
     * let the timer cancel a turn AS the user answered. If this fails because
     * a surface budget dropped below the cap, tighten the cap or raise the
     * budget — one of the two numbers has to move.
     */
    expect(QUESTION_TIMEOUT_MS).toBeLessThan(300_000);
  });

  it('keeps concurrent questions independent', async () => {
    const a = waitForAnswer('qa');
    const b = waitForAnswer('qb');
    resolveAnswer('qb', { pick: 'B' });
    resolveAnswer('qa', { pick: 'A' });
    await expect(a).resolves.toEqual({ pick: 'A' });
    await expect(b).resolves.toEqual({ pick: 'B' });
  });
});

/** DEFECT 6 (regression): a cancelled turn must take its rendezvous with it. */
describe('abort cancellation', () => {
  it('rejects the moment the query is aborted, and frees the entry', async () => {
    const controller = new AbortController();
    const pending = waitForAnswer('abort-q1', { signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow(/cancel/i);
    controller.abort();
    await assertion;

    // no live five-minute timer, no dead resolve closure
    vi.advanceTimersByTime(300_001);
    expect(resolveAnswer('abort-q1', {})).toBe(false);
  });
});
