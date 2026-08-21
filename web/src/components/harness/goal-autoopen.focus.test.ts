// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { useGoalAutoOpen } from './use-goal-autoopen';

/**
 * THE PANEL OPENS ONCE. It does not keep pulling the user back to it.
 *
 * `useGoalAutoOpen` polls every 5s to notice that a goal has come into
 * existence, and calls `__ideOpenGoal`, which called `setActive()` on the
 * panel whether or not it had just created it. The "opened at most once per
 * conversation" guard sat in the EFFECT BODY, so it was evaluated once and the
 * interval callback was never subject to it.
 *
 * The result, reported from use: click the Chat tab, get thrown back to Goal
 * about five seconds later, again, and again, with no way to stay put.
 *
 * The comment on the opener called `setActive()` "idempotent — calling it while
 * the panel is open just focuses it, which is what makes the auto-open effect
 * safe to run on every status poll". Idempotent about EXISTENCE; not about
 * focus, which is the thing the user was fighting.
 */

const CONV = 'conv-1';
const DIR = '/tmp/work';

let openSpy: ReturnType<typeof vi.fn>;

/** Let the in-flight fetch + await chain settle. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  openSpy = vi.fn();
  (window as unknown as Record<string, unknown>).__ideOpenGoal = openSpy;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ goal: { objective: 'do the thing' } }),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__ideOpenGoal;
});

describe('the goal panel opens once per conversation', () => {
  it('opens it when a goal appears', async () => {
    renderHook(() => useGoalAutoOpen(CONV, DIR));
    await settle();
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-open it on every subsequent poll', async () => {
    /*
     * The regression. Five minutes of polling used to be sixty calls, each one
     * yanking the user off whatever tab they had chosen.
     */
    renderHook(() => useGoalAutoOpen(CONV, DIR));
    await settle();

    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      await settle();
    }
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('stops polling once it has opened, rather than spinning forever', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    renderHook(() => useGoalAutoOpen(CONV, DIR));
    await settle();
    const afterOpen = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    // At most one more: the tick that observes the guard and clears the timer.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(afterOpen + 1);
  });

  it('never asks for focus — that is the caller-with-a-user\'s job', async () => {
    renderHook(() => useGoalAutoOpen(CONV, DIR));
    await settle();
    // Called with no argument, so `focus` is falsy and an existing panel is
    // left alone. A poll must not move the user.
    expect(openSpy).toHaveBeenCalledWith();
  });

  it('does nothing at all while there is no goal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    renderHook(() => useGoalAutoOpen(CONV, DIR));
    await settle();
    await vi.advanceTimersByTimeAsync(15_000);
    await settle();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('the opener only steals focus when asked', () => {
  const layout = fs.readFileSync(
    path.join(process.cwd(), 'src/components/surfaces/code/workspace/workspace-layout.tsx'),
    'utf8',
  );

  it('an existing panel is focused only under `focus`', () => {
    const at = layout.indexOf('__ideOpenGoal = (');
    expect(at, 'the opener no longer takes an argument').toBeGreaterThan(-1);
    const opener = layout.slice(at, at + 400);
    expect(opener).toMatch(/if \(focus\) existing\.api\.setActive\(\)/);
  });

  it('send asks for focus, because the user just acted', () => {
    const surface = fs.readFileSync(
      path.join(process.cwd(), 'src/components/surfaces/code/code-surface.tsx'),
      'utf8',
    );
    expect(surface).toMatch(/__ideOpenGoal[\s\S]{0,300}?\)\(true\)/);
  });
});
