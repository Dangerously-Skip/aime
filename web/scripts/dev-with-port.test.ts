import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The dev launcher must not start on a port other than the preferred one.
 *
 * localStorage is keyed by ORIGIN, so `http://localhost:19533` and
 * `http://localhost:64100` are different profiles. Falling back to a free port
 * therefore does not degrade gracefully — it boots the app with no settings, no
 * API keys and no conversations, and strands whatever is saved that session
 * under a port nobody will ever bind again.
 *
 * This profile accumulated TEN such origins before the cause was found, with the
 * settings under one port and the conversations under another. The symptom the
 * user reported was "why do I need to keep going through onboarding?", which
 * reads as data loss and is really an addressing bug.
 *
 * A warning existed and was not enough: it scrolls past in a dev server's output
 * and the app looks merely empty, not misconfigured. So the launcher fails
 * closed, and this asserts that it does.
 */

const SRC = readFileSync(resolve(process.cwd(), 'scripts/dev-with-port.js'), 'utf-8');

describe('the dev launcher fails closed on a busy port', () => {
  it('has a preferred port at all', () => {
    expect(SRC).toMatch(/PREFERRED_DEV_PORT\s*=\s*\d+/);
  });

  /**
   * The load-bearing assertion. Silently calling `findFreePort()` is what
   * stranded the profile; it may now only happen behind the explicit opt-in.
   */
  it('exits rather than silently choosing another port', () => {
    expect(SRC, 'the busy-port branch must terminate the process').toMatch(
      /process\.exit\(1\)/,
    );
  });

  it('still allows an explicit opt-in for anyone who wants a scratch profile', () => {
    expect(SRC).toMatch(/AIME_ALLOW_ANY_PORT/);
  });

  /**
   * The error has to explain the consequence, not just the condition. "Port in
   * use" invites the reader to work around it with another port, which is the
   * one thing that loses their data.
   */
  it('explains that a different port means a blank profile', () => {
    const busyBranch = SRC.slice(SRC.indexOf('is already in use'), SRC.indexOf('process.exit(1)'));
    expect(busyBranch).toMatch(/per-origin|BLANK profile/);
    expect(busyBranch, 'should tell the reader how to free the port').toMatch(/lsof/);
  });

  it('does not reach findFreePort outside the opt-in branch', () => {
    // One definition, one guarded call site. A second call site would be a
    // second way to start on the wrong origin.
    const calls = SRC.match(/await findFreePort\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
  });
});
