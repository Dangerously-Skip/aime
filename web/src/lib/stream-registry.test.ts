import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  streamRegistry,
  StreamAbortCause,
  abortReasonOf,
  onStreamAborted,
  notifyStreamAborted,
  type StreamAbortEvent,
} from './stream-registry';

afterEach(() => {
  // Leave no controller behind: a stale entry would read as "superseded".
  for (const id of ['a', 'b', 'c']) streamRegistry.abort(id);
});

describe('streamRegistry', () => {
  it('aborts the registered controller and drops the entry', () => {
    const controller = new AbortController();
    streamRegistry.set('a', controller);
    expect(streamRegistry.has('a')).toBe(true);

    streamRegistry.abort('a');

    expect(controller.signal.aborted).toBe(true);
    expect(streamRegistry.has('a')).toBe(false);
  });

  it('carries the reason on the signal instead of implying it from membership', () => {
    const user = new AbortController();
    const timedOut = new AbortController();
    streamRegistry.set('a', user);
    streamRegistry.set('b', timedOut);

    streamRegistry.abort('a'); // default: deliberate
    streamRegistry.abort('b', 'timeout');

    // Both entries are gone — membership cannot tell these two apart, which is
    // exactly why the reason travels with the abort.
    expect(streamRegistry.has('a')).toBe(false);
    expect(streamRegistry.has('b')).toBe(false);
    expect(abortReasonOf(user.signal)).toBe('user');
    expect(abortReasonOf(timedOut.signal)).toBe('timeout');
  });

  it('aborting an unknown chat is a no-op', () => {
    expect(() => streamRegistry.abort('nobody-here')).not.toThrow();
    expect(streamRegistry.has('nobody-here')).toBe(false);
  });

  it('release drops the entry for the owning stream', () => {
    const controller = new AbortController();
    streamRegistry.set('a', controller);

    expect(streamRegistry.release('a', controller)).toBe(true);
    expect(streamRegistry.has('a')).toBe(false);
    // Releasing again (entry already gone, e.g. after an abort) still reports
    // ownership: there is no newer stream to defer to.
    expect(streamRegistry.release('a', controller)).toBe(true);
  });

  it('release refuses when a newer stream owns the chat', () => {
    const first = new AbortController();
    const second = new AbortController();
    streamRegistry.set('a', first);
    streamRegistry.set('a', second);

    expect(streamRegistry.release('a', first)).toBe(false);
    // The replacement is untouched.
    expect(streamRegistry.has('a')).toBe(true);
    expect(streamRegistry.release('a', second)).toBe(true);
    expect(streamRegistry.has('a')).toBe(false);
  });
});

describe('abortReasonOf', () => {
  it('returns null for a signal that is not aborted', () => {
    expect(abortReasonOf(new AbortController().signal)).toBeNull();
    expect(abortReasonOf(undefined)).toBeNull();
  });

  it('reads the tagged reason', () => {
    const c = new AbortController();
    c.abort(new StreamAbortCause('superseded'));
    expect(abortReasonOf(c.signal)).toBe('superseded');
  });

  it('treats an untagged abort as deliberate', () => {
    const c = new AbortController();
    c.abort(); // someone cancelling the controller directly
    expect(abortReasonOf(c.signal)).toBe('user');
  });
});

describe('onStreamAborted', () => {
  it('notifies listeners and stops after unsubscribe', () => {
    const seen: StreamAbortEvent[] = [];
    const unsubscribe = onStreamAborted((e) => seen.push(e));

    notifyStreamAborted({ chatId: 'a', reason: 'user' });
    notifyStreamAborted({ chatId: 'b', reason: 'timeout' });
    unsubscribe();
    notifyStreamAborted({ chatId: 'c', reason: 'user' });

    expect(seen).toEqual([
      { chatId: 'a', reason: 'user' },
      { chatId: 'b', reason: 'timeout' },
    ]);
  });

  it('a throwing listener does not stop the others', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();
    const unsubBad = onStreamAborted(() => {
      throw new Error('listener exploded');
    });
    const unsubGood = onStreamAborted(good);

    notifyStreamAborted({ chatId: 'a', reason: 'user' });

    expect(good).toHaveBeenCalledWith({ chatId: 'a', reason: 'user' });
    expect(consoleError).toHaveBeenCalled();
    unsubBad();
    unsubGood();
    consoleError.mockRestore();
  });
});
