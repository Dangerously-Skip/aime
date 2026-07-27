import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { watchStuckTool, STUCK_TOOL_TIMEOUT_MS } from './stuck-tool-watchdog';
import { streamRegistry, abortReasonOf } from './stream-registry';

/**
 * The regression (DEFECT 5b): the per-tool watchdog called
 * `streamRegistry.abort(chatId)` with no reason. That defaults to 'user' — the
 * value that means "someone pressed Stop" — so a tool hanging for two minutes was
 * reported to the user as their own deliberate cancel: no error message in the
 * transcript, and the Run recorded as 'cancelled' rather than 'timeout'.
 *
 * Real registry, real AbortController; only the clock is faked.
 */

const CHAT = 'cowork-1';

function watchRunningTool(status: { value: string | undefined }) {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const stop = watchStuckTool({
    chatId: CHAT,
    toolId: 't-1',
    toolName: 'Read',
    getToolStatus: () => status.value,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return { notify, stop, listenerCount: () => listeners.size };
}

let controller: AbortController;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  controller = new AbortController();
  streamRegistry.set(CHAT, controller);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('watchStuckTool', () => {
  it('aborts a hung tool as a TIMEOUT, not as a user stop', () => {
    watchRunningTool({ value: 'running' });

    vi.advanceTimersByTime(STUCK_TOOL_TIMEOUT_MS);

    expect(controller.signal.aborted).toBe(true);
    expect(abortReasonOf(controller.signal)).toBe('timeout');
  });

  it('does not abort before the deadline', () => {
    watchRunningTool({ value: 'running' });
    vi.advanceTimersByTime(STUCK_TOOL_TIMEOUT_MS - 1);
    expect(controller.signal.aborted).toBe(false);
  });

  it('cancels itself when the tool completes', () => {
    const status = { value: 'running' as string | undefined };
    const watch = watchRunningTool(status);

    status.value = 'complete';
    watch.notify();
    vi.advanceTimersByTime(STUCK_TOOL_TIMEOUT_MS * 2);

    expect(controller.signal.aborted).toBe(false);
    expect(watch.listenerCount()).toBe(0);
  });

  it('cancels itself when the tool call disappears entirely', () => {
    // A conversation switch clears the messages the tool lived in.
    const status = { value: 'running' as string | undefined };
    const watch = watchRunningTool(status);

    status.value = undefined;
    watch.notify();
    vi.advanceTimersByTime(STUCK_TOOL_TIMEOUT_MS * 2);

    expect(controller.signal.aborted).toBe(false);
  });

  it('does not abort a tool that finished after the deadline was scheduled', () => {
    // Belt and braces: the deadline fires, but the tool is no longer running, so
    // there is nothing to kill.
    const status = { value: 'running' as string | undefined };
    watchRunningTool(status);
    status.value = 'complete'; // no notification — e.g. a missed subscription

    vi.advanceTimersByTime(STUCK_TOOL_TIMEOUT_MS);
    expect(controller.signal.aborted).toBe(false);
  });

  it('can be stopped explicitly', () => {
    const watch = watchRunningTool({ value: 'running' });
    watch.stop();
    vi.advanceTimersByTime(STUCK_TOOL_TIMEOUT_MS * 2);
    expect(controller.signal.aborted).toBe(false);
    expect(watch.listenerCount()).toBe(0);
  });

  it('never watches a tool that was already finished', () => {
    const watch = watchRunningTool({ value: 'complete' });
    expect(watch.listenerCount()).toBe(0);
    vi.advanceTimersByTime(STUCK_TOOL_TIMEOUT_MS * 2);
    expect(controller.signal.aborted).toBe(false);
  });
});
