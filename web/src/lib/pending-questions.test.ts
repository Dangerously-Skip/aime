import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForAnswer, resolveAnswer } from './pending-questions';

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

  it('times out after 5 minutes of no answer', async () => {
    const pending = waitForAnswer('q3');
    const assertion = expect(pending).rejects.toThrow('timed out');
    vi.advanceTimersByTime(300_001);
    await assertion;

    expect(resolveAnswer('q3', {})).toBe(false); // entry cleaned up
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
