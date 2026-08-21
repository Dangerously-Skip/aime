// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installXtermFrameErrorFilter } from './xterm-error-boundary';

/**
 * THE HALF A REACT BOUNDARY CANNOT CATCH.
 *
 * xterm schedules `Viewport._innerRefresh` through requestAnimationFrame. When a
 * resize or dispose lands between scheduling and firing, that frame reads
 * `this._renderService.dimensions` on a service that has gone, and throws —
 * ASYNCHRONOUSLY. React error boundaries only see errors thrown during render
 * and commit, so `XtermErrorBoundary` — whose comment says it stops this
 * reaching the dev overlay — structurally cannot. By the time the frame runs
 * there is no React stack to catch it in, and the full-screen overlay appears
 * for something xterm has already recovered from.
 */

/*
 * Installed PER TEST, not in beforeEach. A filter left attached from a previous
 * test makes "it does nothing here" impossible to assert — which is exactly the
 * two cases that matter most: after uninstall, and in production.
 */
let uninstall: () => void = () => {};

const fire = (message: string, error?: Error) => {
  /*
   * `cancelable: true` — a browser's own error event is cancelable, and
   * jsdom's constructor defaults it to false. Without this `preventDefault()`
   * is a no-op and every assertion here reads as "the filter did nothing",
   * which is a test artefact rather than a finding.
   */
  const ev = new ErrorEvent('error', { message, error, cancelable: true });
  window.dispatchEvent(ev);
  /*
   * `defaultPrevented` CANNOT be the signal here: the test environment installs
   * its own error handler that also calls preventDefault, so it reads true even
   * with no filter attached — which made every assertion below pass or fail for
   * the wrong reason.
   *
   * The filter's own debug line is the honest signal: it is emitted only on the
   * path that swallows, so it says whether OUR handler ran.
   */
  const swallowed = (console.debug as unknown as { mock: { calls: unknown[][] } }).mock.calls.some(
    (c) => typeof c[0] === 'string' && c[0].includes('[xterm]'),
  );
  return { swallowed };
};

/**
 * Keep the events we dispatch from counting as UNHANDLED.
 *
 * These tests fire genuine `error` events at `window`. In the cases where no
 * filter is installed — after uninstall, and in production — nothing prevents
 * them, so vitest records them as unhandled errors and fails the run with every
 * test passing. That is a real trap: the suite went green while `npm run verify`
 * went red, which is the shape that reaches CI.
 *
 * Registered in the BUBBLE phase so it runs after the filter's capture-phase
 * listener, and it only suppresses reporting — the filter's own debug line,
 * which is what the assertions read, is untouched.
 */
let swallowAll: (e: ErrorEvent) => void;

beforeEach(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  uninstall = () => {};
  swallowAll = (e: ErrorEvent) => e.preventDefault();
  window.addEventListener('error', swallowAll);
});
afterEach(() => {
  uninstall();
  window.removeEventListener('error', swallowAll);
  vi.restoreAllMocks();
});

/** Install for the duration of one test. */
const withFilter = () => {
  uninstall = installXtermFrameErrorFilter();
};

describe('what it swallows', () => {
  it("swallows xterm's post-dispose dimensions throw", () => {
    withFilter();
    const e = new Error("Cannot read properties of undefined (reading 'dimensions')");
    expect(fire(e.message, e).swallowed).toBe(true);
  });

  it('swallows the _renderService spelling too', () => {
    withFilter();
    const e = new Error("Cannot read properties of null (reading '_renderService')");
    expect(fire(e.message, e).swallowed).toBe(true);
  });

  it('says so at debug level rather than silently', () => {
    withFilter();
    const e = new Error("reading 'dimensions'");
    fire(e.message, e);
    expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('swallowed'));
  });
});

describe('what it must NOT swallow — the reason it is narrow', () => {
  it('lets an unrelated TypeError through', () => {
    withFilter();
    /*
     * A broad window.onerror filter is how a real crash becomes invisible. This
     * one matches one message from one library, so everything else still
     * reaches the overlay.
     */
    const e = new Error('Cannot read properties of undefined (reading "user")');
    expect(fire(e.message, e).swallowed).toBe(false);
  });

  it('lets a generic error through', () => {
    withFilter();
    const e = new Error('Something went badly wrong');
    expect(fire(e.message, e).swallowed).toBe(false);
  });

  it('stops filtering once uninstalled', () => {
    withFilter();
    uninstall();
    const e = new Error("reading 'dimensions'");
    expect(fire(e.message, e).swallowed).toBe(false);
  });
});

describe('production', () => {
  it('installs nothing outside development', () => {
    // An error swallower has no business in a shipped build: there is no dev
    // overlay to protect, and a hidden error is worse than a visible one.
    // `vi.stubEnv` — assigning to process.env.NODE_ENV directly throws under
    // vitest, which guards it with a non-configurable descriptor.
    vi.stubEnv('NODE_ENV', 'production');
    const off = installXtermFrameErrorFilter();
    const e = new Error("reading 'dimensions'");
    expect(fire(e.message, e).swallowed).toBe(false);
    off();
    vi.unstubAllEnvs();
  });
});
