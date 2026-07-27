import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  waitForDocumentPrint,
  resolveDocumentPrint,
  pendingDocumentCount,
  DOCUMENT_PRINT_TIMEOUT_MS,
} from './pending-documents';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pending-documents bridge', () => {
  it('resolves with the print outcome', async () => {
    const p = waitForDocumentPrint('d1');
    // No `path` in the result: the waiter already knows where it asked for the
    // PDF, and the route that reports back authenticates nothing.
    expect(resolveDocumentPrint('d1', { ok: true, bytes: 1024 })).toBe(true);
    await expect(p).resolves.toEqual({ ok: true, bytes: 1024 });
  });

  it('resolves with a failure and its reason', async () => {
    const p = waitForDocumentPrint('d2');
    resolveDocumentPrint('d2', { ok: false, error: 'out of memory' });
    await expect(p).resolves.toEqual({ ok: false, error: 'out of memory' });
  });

  it('resolves rather than rejecting on timeout', async () => {
    // The tool reports the HTML it already wrote; a rejection would surface as a
    // tool error and lose that.
    const p = waitForDocumentPrint('d3');
    vi.advanceTimersByTime(DOCUMENT_PRINT_TIMEOUT_MS + 1);
    await expect(p).resolves.toMatchObject({ ok: false });
  });

  it('times out far faster than the connector bridge — rendering is machine-paced', async () => {
    expect(DOCUMENT_PRINT_TIMEOUT_MS).toBeLessThan(300_000);
    expect(DOCUMENT_PRINT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('returns false for an unknown id so the route can 404', () => {
    expect(resolveDocumentPrint('never', { ok: true })).toBe(false);
  });

  it('does not resolve twice', async () => {
    const p = waitForDocumentPrint('d4');
    expect(resolveDocumentPrint('d4', { ok: true })).toBe(true);
    expect(resolveDocumentPrint('d4', { ok: false })).toBe(false);
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('clears the timer, so a late tick cannot fire', async () => {
    const p = waitForDocumentPrint('d5');
    resolveDocumentPrint('d5', { ok: true });
    await p;
    vi.advanceTimersByTime(DOCUMENT_PRINT_TIMEOUT_MS + 1);
    expect(pendingDocumentCount()).toBe(0);
  });

  it('keeps concurrent prints independent', async () => {
    const a = waitForDocumentPrint('a');
    const b = waitForDocumentPrint('b');
    expect(pendingDocumentCount()).toBe(2);

    resolveDocumentPrint('b', { ok: false, error: 'nope' });
    await expect(b).resolves.toMatchObject({ ok: false });
    resolveDocumentPrint('a', { ok: true });
    await expect(a).resolves.toEqual({ ok: true });
    expect(pendingDocumentCount()).toBe(0);
  });
});

/**
 * DEFECT 2 (regression): "no answer" and "the client tried and failed" are
 * different facts and the tool tells the user different things about them. The
 * timeout used to be indistinguishable from a real print failure, so a run with
 * nobody consuming the stream was told "PDF rendering timed out." instead of the
 * honest "PDF rendering needs the desktop app".
 */
describe('an unanswered print is distinguishable from a failed one', () => {
  it('marks a timeout as unclaimed', async () => {
    const p = waitForDocumentPrint('u1');
    vi.advanceTimersByTime(DOCUMENT_PRINT_TIMEOUT_MS + 1);
    await expect(p).resolves.toMatchObject({ ok: false, unclaimed: true });
  });

  it('does not mark a reported failure as unclaimed', async () => {
    const p = waitForDocumentPrint('u2');
    resolveDocumentPrint('u2', { ok: false, error: 'no chromium' });
    const result = await p;
    expect(result.unclaimed).toBeUndefined();
  });
});

/** DEFECT 6 (regression): a cancelled turn must take its rendezvous with it. */
describe('abort cancellation', () => {
  it('resolves the moment the query is aborted, and frees the entry', async () => {
    const controller = new AbortController();
    const p = waitForDocumentPrint('abort-d1', { signal: controller.signal });
    expect(pendingDocumentCount()).toBe(1);

    controller.abort();
    await expect(p).resolves.toMatchObject({ ok: false });
    expect(pendingDocumentCount()).toBe(0);
    expect(resolveDocumentPrint('abort-d1', { ok: true })).toBe(false);
  });
});
