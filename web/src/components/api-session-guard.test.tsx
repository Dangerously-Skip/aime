// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ApiSessionGuard } from './api-session-guard';

/**
 * A dead API session used to be unrecoverable in-app: the cookie went stale
 * when the dev server and Electron restarted apart, and every polling hook
 * 401'd forever — tens of thousands of console entries, a silently dead app,
 * and the only fix (full restart) something the user had to discover. The
 * guard re-runs the launch-time `?t=` exchange ONCE, then names the fix
 * instead of looping.
 */

type ElectronAPI = { getApiToken: () => Promise<string> };

/** jsdom's location is read-only; replace it with a recording stand-in. */
function mockLocation() {
  const original = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...original, href: original.href, assign: vi.fn(), replace: vi.fn() },
  });
  return () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

function installElectron(token: string | null): ElectronAPI {
  const api: ElectronAPI = { getApiToken: vi.fn().mockResolvedValue(token) };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}

/** A fetch stub returning canned statuses per URL. */
function stubFetch(statusByUrl: (url: string) => number) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: statusByUrl(url),
    });
  });
}

let restoreLocation: () => void;
const savedFetch = window.fetch;

beforeEach(() => {
  sessionStorage.clear();
  restoreLocation = mockLocation();
});

afterEach(() => {
  cleanup();
  window.fetch = savedFetch;
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  restoreLocation();
  vi.restoreAllMocks();
});

describe('ApiSessionGuard', () => {
  it('re-exchanges the token once on the first local /api 401', async () => {
    const api = installElectron('fresh-token');
    window.fetch = stubFetch(() => 401) as typeof window.fetch;
    render(<ApiSessionGuard />);

    await window.fetch('/api/harness?x=1');
    // Give the recovery promise a tick to run.
    await vi.waitFor(() =>
      expect(window.location.href).toContain('t=fresh-token'),
    );
    expect(api.getApiToken).toHaveBeenCalledTimes(1);
    // The TOKEN is remembered, not a count — see below for why.
    expect(sessionStorage.getItem('aime:api-session-tried-token')).toBe('fresh-token');
  });

  it('does not loop: a 401 after retrying THE SAME token only reports', async () => {
    installElectron('stale-token');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    sessionStorage.setItem('aime:api-session-tried-token', 'stale-token');
    window.fetch = stubFetch(() => 401) as typeof window.fetch;
    render(<ApiSessionGuard />);

    await window.fetch('/api/runs');
    await window.fetch('/api/runs');
    await vi.waitFor(() => expect(err).toHaveBeenCalled());
    expect(window.location.href).not.toContain('t=');
    expect(err.mock.calls[0][0]).toContain('Restart the app');
  });

  it('HEALS A SECOND DIVERGENCE — the ceiling the boolean flag imposed', async () => {
    /*
     * The bug this replaced. A window open across two dev-server restarts
     * healed the first and was permanently dead to the second: the flag was
     * already set, so nothing retried and every /api call 401'd until someone
     * thought to quit the app.
     *
     * Reported as the Design gallery rendering unstyled — a 401 on a
     * `<link rel=stylesheet>` is dropped silently, so a dead session shows up
     * as a bland theme rather than as an error.
     *
     * A DIFFERENT token must always get its attempt; only a repeat of the same
     * one is refused, which is the loop the guard actually exists to prevent.
     */
    installElectron('second-token');
    sessionStorage.setItem('aime:api-session-tried-token', 'first-token');
    window.fetch = stubFetch(() => 401) as typeof window.fetch;
    render(<ApiSessionGuard />);

    await window.fetch('/api/runs');
    await vi.waitFor(() => expect(window.location.href).toContain('t=second-token'));
    expect(sessionStorage.getItem('aime:api-session-tried-token')).toBe('second-token');
  });

  it('ignores 401s from other origins — that is not a session problem', async () => {
    const api = installElectron('t');
    window.fetch = stubFetch((url) => (url.includes('example.com') ? 401 : 200)) as typeof window.fetch;
    render(<ApiSessionGuard />);

    const res = await window.fetch('https://example.com/api/thing');
    expect(res.status).toBe(401);
    expect(api.getApiToken).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain('t=');
  });

  it('leaves non-401 responses untouched', async () => {
    installElectron('t');
    window.fetch = stubFetch(() => 200) as typeof window.fetch;
    render(<ApiSessionGuard />);

    const res = await window.fetch('/api/health');
    expect(res.status).toBe(200);
    expect(sessionStorage.getItem('aime:api-session-retried')).toBeNull();
  });

  it('installs nothing without the Electron bridge (plain browser)', () => {
    const before = window.fetch;
    render(<ApiSessionGuard />);
    expect(window.fetch).toBe(before);
  });

  it('restores interception on unmount', async () => {
    const api = installElectron('t');
    window.fetch = stubFetch(() => 401) as typeof window.fetch;
    const { unmount } = render(<ApiSessionGuard />);

    // Mounted: the patch is live.
    await window.fetch('/api/runs');
    await vi.waitFor(() => expect(api.getApiToken).toHaveBeenCalledTimes(1));

    // Unmounted: 401s pass through with no further recovery attempts.
    sessionStorage.removeItem('aime:api-session-retried');
    unmount();
    const res = await window.fetch('/api/runs');
    expect(res.status).toBe(401);
    expect(api.getApiToken).toHaveBeenCalledTimes(1);
  });
});
