import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRendezvous } from './rendezvous';

/**
 * The generalised bridge behind pending-questions / -browser-tools / -connectors
 * / -documents.
 *
 * The behaviour that only exists here — and the reason the four were merged — is
 * abort cancellation: pressing Stop with a card open used to leave a live timer
 * and a captured `resolve` closure for the full timeout.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const resolving = () =>
  createRendezvous<{ ok: boolean; why?: string }>({
    label: 'test-resolve',
    timeoutMs: 1000,
    onTimeout: { resolve: { ok: false, why: 'timeout' } },
    onAbort: { resolve: { ok: false, why: 'aborted' } },
  });

const rejecting = () =>
  createRendezvous<string>({
    label: 'test-reject',
    timeoutMs: 1000,
    onTimeout: { reject: 'timed out' },
    onAbort: { reject: 'cancelled' },
  });

describe('createRendezvous — delivery', () => {
  it('settles a waiting promise with the delivered value', async () => {
    const r = resolving();
    const waiting = r.wait('a');
    expect(r.settle('a', { ok: true })).toBe(true);
    await expect(waiting).resolves.toEqual({ ok: true });
    expect(r.size()).toBe(0);
  });

  it('returns false for an unknown id so a route can 404', () => {
    expect(resolving().settle('nope', { ok: true })).toBe(false);
  });

  it('does not settle twice', async () => {
    const r = resolving();
    const waiting = r.wait('a');
    expect(r.settle('a', { ok: true })).toBe(true);
    expect(r.settle('a', { ok: false })).toBe(false);
    await expect(waiting).resolves.toEqual({ ok: true });
  });

  it('keeps concurrent waits independent', async () => {
    const r = resolving();
    const a = r.wait('a');
    const b = r.wait('b');
    expect(r.size()).toBe(2);
    r.settle('b', { ok: false, why: 'nope' });
    await expect(b).resolves.toEqual({ ok: false, why: 'nope' });
    expect(r.size()).toBe(1);
    r.settle('a', { ok: true });
    await expect(a).resolves.toEqual({ ok: true });
    expect(r.size()).toBe(0);
  });

  it('clears the timer on delivery, so a late tick cannot fire', async () => {
    const r = resolving();
    const waiting = r.wait('a');
    r.settle('a', { ok: true });
    await waiting;
    vi.advanceTimersByTime(5000);
    expect(r.size()).toBe(0);
  });
});

describe('createRendezvous — the no-answer budget', () => {
  it('resolves with onTimeout when configured to resolve', async () => {
    const r = resolving();
    const waiting = r.wait('a');
    vi.advanceTimersByTime(1001);
    await expect(waiting).resolves.toEqual({ ok: false, why: 'timeout' });
    expect(r.size()).toBe(0);
  });

  it('rejects with onTimeout when configured to reject', async () => {
    const r = rejecting();
    const waiting = r.wait('a');
    const assertion = expect(waiting).rejects.toThrow('timed out');
    vi.advanceTimersByTime(1001);
    await assertion;
    expect(r.size()).toBe(0);
  });

  it('refuses a late answer after a timeout rather than resolving a dead promise', async () => {
    const r = resolving();
    const waiting = r.wait('a');
    vi.advanceTimersByTime(1001);
    await waiting;
    expect(r.settle('a', { ok: true })).toBe(false);
  });
});

describe('createRendezvous — abort cancellation', () => {
  it('settles immediately when the query is aborted, and frees the entry', async () => {
    const r = resolving();
    const controller = new AbortController();
    const waiting = r.wait('a', { signal: controller.signal });
    expect(r.size()).toBe(1);

    controller.abort();
    await expect(waiting).resolves.toEqual({ ok: false, why: 'aborted' });
    // No live timer, no captured closure — the leak this exists to stop.
    expect(r.size()).toBe(0);
  });

  it('rejects on abort when configured to reject', async () => {
    const r = rejecting();
    const controller = new AbortController();
    const waiting = r.wait('a', { signal: controller.signal });
    const assertion = expect(waiting).rejects.toThrow('cancelled');
    controller.abort();
    await assertion;
  });

  it('settles at once for a signal that is already aborted, registering no timer', async () => {
    const r = resolving();
    const controller = new AbortController();
    controller.abort();
    await expect(r.wait('a', { signal: controller.signal })).resolves.toEqual({
      ok: false,
      why: 'aborted',
    });
    expect(r.size()).toBe(0);
  });

  it('drops its abort listener once delivered, so a later abort is inert', async () => {
    const r = resolving();
    const controller = new AbortController();
    const waiting = r.wait('a', { signal: controller.signal });
    r.settle('a', { ok: true });
    await expect(waiting).resolves.toEqual({ ok: true });
    // Would throw "settled twice" through an unhandled rejection if still attached.
    controller.abort();
    expect(r.size()).toBe(0);
  });

  it('only cancels the waits that belong to the aborted query', async () => {
    const r = resolving();
    const mine = new AbortController();
    const theirs = new AbortController();
    const a = r.wait('a', { signal: mine.signal });
    const b = r.wait('b', { signal: theirs.signal });

    mine.abort();
    await expect(a).resolves.toMatchObject({ why: 'aborted' });
    expect(r.size()).toBe(1);

    r.settle('b', { ok: true });
    await expect(b).resolves.toEqual({ ok: true });
  });
});

describe('createRendezvous — a re-used id', () => {
  it('displaces the previous waiter instead of orphaning its timer', async () => {
    const r = resolving();
    const first = r.wait('dup');
    const second = r.wait('dup');
    // The displaced waiter settles as cancelled rather than hanging forever.
    await expect(first).resolves.toEqual({ ok: false, why: 'aborted' });
    expect(r.size()).toBe(1);

    r.settle('dup', { ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(r.size()).toBe(0);
  });
});
