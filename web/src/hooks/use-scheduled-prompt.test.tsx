// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useScheduledPrompt } from './use-scheduled-prompt';
import { useContextBusStore } from '@/stores/context-bus-store';

/**
 * A DUE CRON JOB HAS TO ACTUALLY RUN.
 *
 * It published to the context bus and switched surface, and the call site said
 * "the surface named by the job owns actually running it" — but nothing
 * subscribed. Code and Cowork fold unconsumed bus events into the NEXT HUMAN
 * MESSAGE; chat, browser and assistant never read the bus. So a job fired, the
 * surface changed, and the work never happened.
 *
 * The e2e proved the switch and `lastRun` — exactly the half that worked.
 */

const fireCron = (surface: string, prompt: string, jobId = 'job-1') =>
  useContextBusStore.getState().publish({
    summary: prompt,
    source: `cron:${jobId}`,
    priority: 'p0',
    targetSurface: surface,
    payload: { prompt, cronJobId: jobId },
  });

beforeEach(() => {
  useContextBusStore.setState({ events: [] } as never);
});

/*
 * UNMOUNT BETWEEN TESTS. Without this, hooks from earlier tests stay mounted and
 * consume the event first, so a later test's own submit never fires — three
 * tests failed that way and passed in isolation.
 *
 * Worth noting what it implies for production rather than just silencing it:
 * consumption is first-come, so exactly one subscriber per surface must exist.
 * That holds today because each surface mounts the hook once, and it is why the
 * hook filters on `targetSurface` rather than every surface racing for a job.
 */
afterEach(cleanup);

describe('running the job', () => {
  it('submits the prompt through the surface own submit', async () => {
    const submit = vi.fn();
    renderHook(() => useScheduledPrompt('browser', submit));
    act(() => { fireCron('browser', 'Re-price the watchlist'); });
    await waitFor(() => expect(submit).toHaveBeenCalledWith('Re-price the watchlist'));
  });

  it('ignores a job addressed to a DIFFERENT surface', () => {
    // Every surface runs this hook; without the filter one job runs five times.
    const submit = vi.fn();
    renderHook(() => useScheduledPrompt('chat', submit));
    act(() => { fireCron('browser', 'not for you'); });
    expect(submit).not.toHaveBeenCalled();
  });

  it('ignores ordinary bus events', () => {
    // The bus carries background context too; only a cron payload is a command.
    const submit = vi.fn();
    renderHook(() => useScheduledPrompt('chat', submit));
    act(() => {
      useContextBusStore.getState().publish({
        summary: 'a file changed', source: 'watcher', priority: 'p1', targetSurface: 'chat',
      });
    });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('running it exactly once', () => {
  it('does not re-run on re-render', async () => {
    /*
     * The event stays in the store, so an unconsumed one would fire again on
     * every render — a scheduled agent turn costs money and can act on the
     * world.
     */
    const submit = vi.fn();
    const { rerender } = renderHook(() => useScheduledPrompt('chat', submit));
    act(() => { fireCron('chat', 'go'); });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('consumes the event even when submit throws', async () => {
    /*
     * Consume BEFORE submitting. Losing a scheduled run is recoverable — it
     * fires again next interval — and doubling one may not be.
     */
    const submit = vi.fn().mockRejectedValue(new Error('provider down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useScheduledPrompt('chat', submit));
    act(() => { fireCron('chat', 'go'); });
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(useContextBusStore.getState().events[0].consumed).toBe(true);
  });

  it('a throwing submit does not take the surface down', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useScheduledPrompt('chat', submit));
      act(() => { fireCron('chat', 'go'); });
    }).not.toThrow();
  });

  it('a second job later still runs', async () => {
    // Consuming the first must not deafen the surface to the next one.
    const submit = vi.fn();
    renderHook(() => useScheduledPrompt('chat', submit));
    act(() => { fireCron('chat', 'first', 'j1'); });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    act(() => { fireCron('chat', 'second', 'j2'); });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit).toHaveBeenLastCalledWith('second');
  });
});

describe('a busy surface defers the job instead of dropping it', () => {
  it('does not submit or consume while busy', () => {
    const submit = vi.fn();
    renderHook(() =>
      useScheduledPrompt('chat', submit, () => true, { retryMs: 10 }),
    );
    act(() => { fireCron('chat', 'while busy'); });
    expect(submit).not.toHaveBeenCalled();
    // The event must still be unconsumed: consuming it here is what made a
    // job firing mid-turn vanish permanently.
    expect(useContextBusStore.getState().events[0].consumed).toBe(false);
  });

  it('runs the deferred job once the surface frees up', async () => {
    let busy = true;
    const submit = vi.fn();
    renderHook(() =>
      useScheduledPrompt('chat', submit, () => busy, { retryMs: 10 }),
    );
    act(() => { fireCron('chat', 'queued work'); });
    await new Promise((r) => setTimeout(r, 50)); // several retries, all busy
    expect(submit).not.toHaveBeenCalled();

    busy = false;
    await waitFor(() => expect(submit).toHaveBeenCalledWith('queued work'));
    expect(useContextBusStore.getState().events[0].consumed).toBe(true);
  });

  it('an absent guard behaves as not-busy (existing callers unchanged)', async () => {
    const submit = vi.fn();
    renderHook(() => useScheduledPrompt('browser', submit));
    act(() => { fireCron('browser', 'no guard'); });
    await waitFor(() => expect(submit).toHaveBeenCalledWith('no guard'));
  });
});
