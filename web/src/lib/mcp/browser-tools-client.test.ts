import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * The client half of the capability declaration.
 *
 * The server registers browser tools only when the CLIENT says it has a live
 * webview, because nothing on the server can tell: `onBrowserToolUse` is built
 * for every surface, and Code's preview panel can be closed. That makes the
 * client's honesty load-bearing — a surface that declares the capability
 * without one gives the model tools nothing can execute, which is DR-21's
 * infinite loop.
 */

const src = (...p: string[]) => readFileSync(resolve(__dirname, '../..', ...p), 'utf8');
const hook = src('hooks/use-sse-stream.ts');
const code = src('components/surfaces/code/code-surface.tsx');
const chat = src('components/surfaces/chat/chat-surface.tsx');
const cowork = src('components/surfaces/cowork/cowork-surface.tsx');

describe('the flag travels', () => {
  it('the SSE hook accepts and forwards it', () => {
    expect(hook).toMatch(/browserToolsAvailable\?: boolean;/);
    expect(hook).toMatch(/browserToolsAvailable: true/);
  });

  it('it is only sent when TRUE, never as false', () => {
    /*
     * The server defaults it to false, so sending `false` explicitly is noise.
     * More importantly the spread form means a surface that never heard of this
     * field cannot accidentally arm it.
     */
    expect(hook).toMatch(/\.\.\.\(extra\?\.browserToolsAvailable \? \{ browserToolsAvailable: true \} : \{\}\)/);
  });
});

describe('Code declares it only when the preview is open', () => {
  it('keys off the live webview ref, not the surface', () => {
    /*
     * `previewWebviewRef.current` is null when the panel is closed. Declaring
     * unconditionally would offer `navigate` with nothing to navigate — and the
     * agent cannot discover that a step is impossible, so it repeats it until
     * the turn dies.
     */
    expect(code).toMatch(/browserToolsAvailable:\s*!!previewWebviewRef\.current/);
  });

  it('can actually execute what it declares', () => {
    // The other half: a declaration is only honest if the surface handles the
    // resulting tool calls. Code's handler predates this work.
    expect(code).toContain('browser_tool_use');
    expect(code).toContain('executeToolInWebview');
    expect(code).toContain('/api/chat/browser-tool-result');
  });
});

describe('surfaces with no webview do not declare it', () => {
  it.each([
    ['chat', chat],
    ['cowork', cowork],
  ])('%s never sets browserToolsAvailable', (_name, source) => {
    /*
     * Neither has a webview. If one ever grows one, this failing is the prompt
     * to also give it a `browser_tool_use` handler — declaring without handling
     * is the failure mode this whole file guards.
     */
    expect(source).not.toContain('browserToolsAvailable');
  });
});
