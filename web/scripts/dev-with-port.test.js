import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The launcher runs two processes that only make sense together: a Next.js dev
 * server and an Electron window pointed at it. If the server goes and the window
 * stays, the result is not an error — it is an app that hangs on every request
 * with nothing in the UI to say why. It reads as "AIME froze", and the event
 * that caused it happened silently, possibly hours earlier.
 *
 * That shipped as a single operator:
 *
 *     next.on('close', (code) => {
 *       if (code !== 0 && code !== null) { electron.kill(); … }
 *     });
 *
 * `code` is `null` whenever a child is killed by a SIGNAL — the OOM killer, or a
 * stray `kill`. Those are the ordinary ways a dev server dies, and each one took
 * the branch that does nothing.
 *
 * Asserted against source because the logic lives inside a top-level IIFE that
 * spawns real processes; there is nothing importable to drive, and refactoring
 * the launcher to make it testable would be a larger change than the fix.
 */

const SRC = fs.readFileSync(path.resolve(__dirname, 'dev-with-port.js'), 'utf-8');

/** The body of the `next.on('close', …)` handler. */
const nextCloseHandler = (() => {
  const start = SRC.indexOf("next.on('close'");
  if (start === -1) throw new Error("no next.on('close') handler — has the launcher changed?");
  return SRC.slice(start, start + 900);
})();

describe('the dev launcher tears the pair down together', () => {
  it('kills the window when the server exits', () => {
    expect(nextCloseHandler, 'the server can die without closing the window').toMatch(
      /electron\.kill\(\)/,
    );
  });

  /**
   * The regression itself. Any guard on the exit code re-admits the signal case,
   * because a signal kill has no exit code to test.
   */
  it('does not make that conditional on the exit code', () => {
    expect(
      nextCloseHandler,
      'a `code !== null` guard skips exactly the signal kills this exists to catch',
    ).not.toMatch(/if\s*\(\s*code\s*!==/);
  });

  it('reports what happened, since nothing else will', () => {
    expect(nextCloseHandler, 'the window closes with no explanation').toMatch(
      /console\.(error|warn)/,
    );
    expect(nextCloseHandler, 'the signal is not named in the message').toMatch(/signal/);
  });
});

describe('the window closing still stops the server', () => {
  it('kills next when electron closes, so no orphan server survives', () => {
    const start = SRC.indexOf("electron.on('close'");
    expect(start, "no electron.on('close') handler").toBeGreaterThan(-1);
    expect(SRC.slice(start, start + 300)).toMatch(/next\.kill\(\)/);
  });
});
