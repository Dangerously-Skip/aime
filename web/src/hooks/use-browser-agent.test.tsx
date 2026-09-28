// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useBrowserAgent, BROWSER_AGENT_STEP_LIMIT } from './use-browser-agent';
import type { WebviewRef } from '@/lib/browser-tools';

/**
 * The quick-ask loop's step budget and the user's ability to stop it.
 *
 * At 25 steps the loop fell out of its `for` and ended SILENTLY — no message,
 * no choice. It now asks (`onStepLimit`), continues on yes, and says why it
 * stopped on no. Stop/Take over is `abort()`, which must end the loop.
 *
 * The model is faked at the fetch boundary: every turn asks for one more
 * `scroll`, so the loop only ends by the limit or by abort.
 */

let turns = 0;
function sseTurn(): Response {
  turns += 1;
  const events = [
    { type: 'tool_use', id: `t${turns}`, name: 'scroll', input: { direction: 'down', amount: turns } },
    { type: 'turn_complete', stop_reason: 'tool_use' },
  ];
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  }), { status: 200 });
}

const webview: WebviewRef = {
  executeJavaScript: async () => null,
  loadURL: async () => {},
  goBack: () => {},
  goForward: () => {},
  reload: () => {},
  getURL: () => 'https://example.com',
  capturePage: async () => ({ toDataURL: () => '' }),
};

function setup(extra: Partial<Parameters<typeof useBrowserAgent>[0]> = {}) {
  const opts = {
    onText: vi.fn(),
    onToolUse: vi.fn(),
    onToolResult: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onPhaseChange: vi.fn(),
    ...extra,
  };
  const { result } = renderHook(() => useBrowserAgent(opts));
  return { opts, result };
}

beforeEach(() => {
  turns = 0;
  vi.stubGlobal('fetch', vi.fn(async () => sseTurn()));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the step limit asks instead of stopping silently', () => {
  it('asks at the limit, and stops with a message when told no', async () => {
    const onStepLimit = vi.fn(async () => false);
    const { opts, result } = setup({ onStepLimit });
    await act(() => result.current.runAgentLoop('go', { model: null }, webview));
    expect(turns).toBe(BROWSER_AGENT_STEP_LIMIT);
    expect(onStepLimit).toHaveBeenCalledWith(BROWSER_AGENT_STEP_LIMIT);
    expect(vi.mocked(opts.onText).mock.calls.map((c) => c[0]).join('')).toMatch(/step limit/);
    expect(opts.onDone).toHaveBeenCalledTimes(1);
  });

  it('Continue grants another block of steps', async () => {
    const onStepLimit = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const { result } = setup({ onStepLimit });
    await act(() => result.current.runAgentLoop('go', { model: null }, webview));
    expect(turns).toBe(BROWSER_AGENT_STEP_LIMIT * 2);
    expect(onStepLimit).toHaveBeenCalledTimes(2);
  });

  it('with no handler it still says why it stopped', async () => {
    const { opts, result } = setup();
    await act(() => result.current.runAgentLoop('go', { model: null }, webview));
    expect(turns).toBe(BROWSER_AGENT_STEP_LIMIT);
    expect(vi.mocked(opts.onText).mock.calls.map((c) => c[0]).join('')).toMatch(/step limit/);
  });
});

describe('Stop / Take over', () => {
  it('abort ends the loop mid-run', async () => {
    const holder: { abort?: () => void } = {};
    const { opts, result } = setup({
      onToolResult: vi.fn(() => { if (turns === 3) holder.abort?.(); }),
    });
    holder.abort = () => result.current.abort();
    await act(() => result.current.runAgentLoop('go', { model: null }, webview));
    expect(turns).toBe(3);
    expect(opts.onDone).toHaveBeenCalledTimes(1);
    expect(opts.onPhaseChange).toHaveBeenLastCalledWith('idle');
  });

  it('abort while the continue prompt is open ends the run without another step', async () => {
    const holder: { abort?: () => void } = {};
    const onStepLimit = vi.fn(async () => { holder.abort?.(); return true; });
    const { result } = setup({ onStepLimit });
    holder.abort = () => result.current.abort();
    await act(() => result.current.runAgentLoop('go', { model: null }, webview));
    expect(turns).toBe(BROWSER_AGENT_STEP_LIMIT);
  });
});
