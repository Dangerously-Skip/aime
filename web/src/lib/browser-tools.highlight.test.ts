// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { executeToolInWebview, highlightScript, MARK_INTERACTIVE_JS, type WebviewRef } from './browser-tools';

/**
 * The element the agent is about to act on is outlined first, so someone
 * watching the page can see what it is going to press. The scripts run for real
 * against jsdom's DOM, the way the page would run them.
 */

/** Evaluate a page script the way `executeJavaScript` does (last expression). */
const run = (code: string): unknown => new Function(`return (${code.trim()})`)();

beforeEach(() => {
  document.body.innerHTML = '<button id="go">Go</button><input id="q" />';
  delete (window as unknown as Record<string, unknown>).__aimeSnapVersion;
  // jsdom reports every rect as 0x0, which the marking script (rightly) skips.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  new Function(`${MARK_INTERACTIVE_JS}; return markInteractive();`)();
});

const refFor = (id: string) => document.getElementById(id)!.getAttribute('data-agent-ref')!;

function pageWebview(): WebviewRef & { scripts: string[] } {
  const scripts: string[] = [];
  return {
    scripts,
    executeJavaScript: async (code: string) => { scripts.push(code); return run(code); },
    loadURL: async () => {}, goBack: () => {}, goForward: () => {}, reload: () => {},
    getURL: () => 'about:blank',
    capturePage: async () => ({ toDataURL: () => '' }),
  };
}

describe('highlightScript', () => {
  it('outlines the target without being able to intercept the click', () => {
    expect(run(highlightScript(refFor('go')))).toBe(true);
    const box = document.querySelector<HTMLElement>('[data-aime-highlight]');
    expect(box).not.toBeNull();
    expect(box!.style.pointerEvents).toBe('none');
    expect(box!.style.position).toBe('fixed');
  });

  it('draws nothing for a ref that does not resolve', () => {
    expect(run(highlightScript('999:999'))).toBe(false);
    expect(document.querySelector('[data-aime-highlight]')).toBeNull();
  });
});

describe('executeToolInWebview outlines before acting', () => {
  it('click: outline first, then the click lands', async () => {
    const wv = pageWebview();
    let clicked = false;
    document.getElementById('go')!.addEventListener('click', () => { clicked = true; });
    const result = await executeToolInWebview(wv, 'click', { ref: refFor('go') });
    expect(result.success, result.message).toBe(true);
    expect(clicked).toBe(true);
    expect(wv.scripts[0]).toContain('data-aime-highlight');
    expect(document.querySelector('[data-aime-highlight]')).not.toBeNull();
  });

  it('non-element tools are not outlined', async () => {
    const wv = pageWebview();
    await executeToolInWebview(wv, 'scroll', { direction: 'down' });
    expect(wv.scripts.some((s) => s.includes('data-aime-highlight'))).toBe(false);
  });
});
