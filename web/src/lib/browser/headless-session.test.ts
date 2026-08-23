import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setHeadlessTransport,
  openHeadlessSession,
  closeHeadlessSession,
  closeAllHeadlessSessions,
  reclaimIdle,
  headlessSessionCount,
  headlessAvailable,
  HeadlessUnavailable,
  MAX_HEADLESS_SESSIONS,
  HEADLESS_IDLE_MS,
} from './headless-session';

/**
 * THE LIFECYCLE IS THE RISKY PART, not the tools (DR-23 D-3).
 *
 * A Chromium window is not free, three standing orders can fire at 9am, and a
 * run that hangs must not hold one for ever. Every rule here is a way the
 * feature could take the machine down or quietly stop working, so each is
 * tested rather than commented.
 */

const opened: string[] = [];
const closed: string[] = [];

function transport(available = true) {
  return {
    available: () => available,
    open: vi.fn(async (id: string) => void opened.push(id)),
    call: vi.fn(async () => undefined),
    close: vi.fn(async (id: string) => void closed.push(id)),
  };
}

beforeEach(async () => {
  opened.length = 0;
  closed.length = 0;
  await closeAllHeadlessSessions();
  setHeadlessTransport(transport());
});

afterEach(async () => {
  await closeAllHeadlessSessions();
  setHeadlessTransport(null);
});

describe('when there is no browser to borrow', () => {
  it('reports itself unavailable', () => {
    setHeadlessTransport(null);
    expect(headlessAvailable()).toBe(false);
  });

  it('throws with a message the agent can act on', async () => {
    /*
     * Not null. A caller handed null carries on without a browser and answers
     * from whatever it could reach — which is exactly the confidently-wrong
     * output this week has been about. And "unavailable" alone sends a model
     * round the same loop, so the message names the alternative.
     */
    setHeadlessTransport(null);
    await expect(openHeadlessSession('run-1')).rejects.toBeInstanceOf(HeadlessUnavailable);
    await expect(openHeadlessSession('run-1')).rejects.toThrow(/FetchUrl/);
  });

  it('is unavailable when the transport says so, even if it exists', async () => {
    // Dev: the server is not a utilityProcess, so there is no main to ask.
    setHeadlessTransport(transport(false));
    expect(headlessAvailable()).toBe(false);
    await expect(openHeadlessSession('run-1')).rejects.toBeInstanceOf(HeadlessUnavailable);
  });
});

describe('one browser per run', () => {
  it('opens one and reuses it', async () => {
    const a = await openHeadlessSession('run-1');
    const b = await openHeadlessSession('run-1');
    expect(a).toBe(b);
    expect(opened).toEqual(['run-1']);
  });

  it('gives different runs different browsers', async () => {
    /*
     * Without this a nightly fan-out has every run driving whichever page moved
     * last — and the tools would report success while acting on the wrong site.
     */
    const a = await openHeadlessSession('run-a');
    const b = await openHeadlessSession('run-b');
    expect(a).not.toBe(b);
    expect(opened).toEqual(['run-a', 'run-b']);
  });
});

describe('the cap', () => {
  it('refuses beyond the limit rather than opening more', async () => {
    for (let i = 0; i < MAX_HEADLESS_SESSIONS; i++) await openHeadlessSession(`run-${i}`);
    await expect(openHeadlessSession('one-too-many')).rejects.toBeInstanceOf(HeadlessUnavailable);
    expect(opened).toHaveLength(MAX_HEADLESS_SESSIONS);
  });

  it('refuses rather than queueing, and says why', async () => {
    /*
     * Queueing spends a scheduled run's budget and deadline waiting behind
     * another run's page load. Refusing lets it fall back to fetching.
     */
    for (let i = 0; i < MAX_HEADLESS_SESSIONS; i++) await openHeadlessSession(`run-${i}`);
    await expect(openHeadlessSession('x')).rejects.toThrow(/in use by other runs/i);
  });

  it('frees a slot when a run closes', async () => {
    for (let i = 0; i < MAX_HEADLESS_SESSIONS; i++) await openHeadlessSession(`run-${i}`);
    await closeHeadlessSession('run-0');
    await expect(openHeadlessSession('new-run')).resolves.toBeTruthy();
  });
});

describe('closing', () => {
  it('closes the remote browser, not just the local record', async () => {
    await openHeadlessSession('run-1');
    await closeHeadlessSession('run-1');
    expect(closed).toEqual(['run-1']);
    expect(headlessSessionCount()).toBe(0);
  });

  it('is safe for a run that never opened one', async () => {
    await expect(closeHeadlessSession('never-existed')).resolves.toBeUndefined();
    expect(closed).toEqual([]);
  });

  it('is safe twice — an abort and a normal finish can both fire', async () => {
    await openHeadlessSession('run-1');
    await closeHeadlessSession('run-1');
    await expect(closeHeadlessSession('run-1')).resolves.toBeUndefined();
    expect(closed).toEqual(['run-1']);
  });
});

describe('idle reclamation', () => {
  it('reclaims a session nothing has touched', async () => {
    /*
     * Without this the cap becomes a permanent outage rather than a queue: one
     * hung run holds a slot for the life of the process.
     */
    const t0 = 1_000_000;
    await openHeadlessSession('stuck', t0);
    expect(reclaimIdle(t0 + HEADLESS_IDLE_MS)).toEqual(['stuck']);
    expect(closed).toEqual(['stuck']);
    expect(headlessSessionCount()).toBe(0);
  });

  it('leaves an active session alone', async () => {
    const t0 = 1_000_000;
    await openHeadlessSession('busy', t0);
    expect(reclaimIdle(t0 + HEADLESS_IDLE_MS - 1)).toEqual([]);
    expect(headlessSessionCount()).toBe(1);
  });

  it('using the browser keeps it alive', async () => {
    // The clock that matters is last USE, not last open — a long run that is
    // working must not be reclaimed out from under itself.
    const t0 = 1_000_000;
    const wv = await openHeadlessSession('working', t0);
    await wv.executeJavaScript('1'); // touches lastUsedAt with the real clock
    expect(reclaimIdle(t0 + HEADLESS_IDLE_MS)).toEqual([]);
  });

  it('opening reclaims first, so a stale slot does not block a new run', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_HEADLESS_SESSIONS; i++) await openHeadlessSession(`old-${i}`, t0);
    await expect(
      openHeadlessSession('fresh', t0 + HEADLESS_IDLE_MS),
    ).resolves.toBeTruthy();
  });
});
