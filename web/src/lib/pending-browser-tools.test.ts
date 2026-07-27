import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  waitForBrowserToolResult,
  resolveBrowserToolResult,
  pendingBrowserToolCount,
  BROWSER_TOOL_TIMEOUT_MS,
} from './pending-browser-tools';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pending browser-tool bridge', () => {
  it('resolves with the webview execution result', async () => {
    const p = waitForBrowserToolResult('b1');
    expect(resolveBrowserToolResult('b1', 'clicked', false)).toBe(true);
    await expect(p).resolves.toEqual({ output: 'clicked', isError: false });
  });

  it('carries an error result through', async () => {
    const p = waitForBrowserToolResult('b2');
    resolveBrowserToolResult('b2', 'no such element', true);
    await expect(p).resolves.toEqual({ output: 'no such element', isError: true });
  });

  it('rejects on timeout — a browser step that never ran is a tool failure', async () => {
    const p = waitForBrowserToolResult('b3');
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    vi.advanceTimersByTime(BROWSER_TOOL_TIMEOUT_MS + 1);
    await assertion;
    expect(pendingBrowserToolCount()).toBe(0);
  });

  it('returns false for an unknown id so the route can 404', () => {
    expect(resolveBrowserToolResult('never', 'x', false)).toBe(false);
  });

  it('does not resolve twice', async () => {
    const p = waitForBrowserToolResult('b4');
    expect(resolveBrowserToolResult('b4', 'first', false)).toBe(true);
    expect(resolveBrowserToolResult('b4', 'second', false)).toBe(false);
    await expect(p).resolves.toEqual({ output: 'first', isError: false });
  });

  /** DEFECT 6 (regression): a cancelled turn must take its rendezvous with it. */
  it('rejects the moment the query is aborted, and frees the entry', async () => {
    const controller = new AbortController();
    const p = waitForBrowserToolResult('abort-b1', { signal: controller.signal });
    const assertion = expect(p).rejects.toThrow(/cancel/i);
    controller.abort();
    await assertion;
    expect(pendingBrowserToolCount()).toBe(0);
  });
});
