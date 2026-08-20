import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BROWSER_TOOL_SCHEMAS, BROWSER_TOOL_NAMES } from './browser-tools';

/*
 * A DECLARED TOOL THAT NOTHING EXECUTES IS AN INFINITE LOOP.
 *
 * A user asked the browser agent to open some listings "in new tabs". Sixteen
 * tools existed and none of them created a tab — `switch_tab` only switches to
 * one that is already open. The instruction was not executable, and nothing in
 * the agent loop can notice a plan step no tool satisfies, so the agent restated
 * the same intent four times and drifted onto an unrelated page:
 *
 *   "let me go back to the camera search page and click the actual links…"
 *   "Let me go back to the camera search results page and open…"
 *   "Let me go back to the camera search results and click the top ROI items…"
 *   "I'll go back to the working camera page:"
 *
 * The failure has a name — FM1, "context-bound search loops" (arXiv 2606.20724)
 * — but the cause here was not subtle reasoning failure. It was a missing verb.
 *
 * So this file checks the three places a tool has to exist, because a gap in any
 * of them produces the same silent loop:
 *
 *   1. a schema, or the model cannot call it
 *   2. an executor branch, or the call does nothing
 *   3. a wired callback, or the executor has nothing to call
 */

const src = (...p: string[]) => readFileSync(resolve(__dirname, '..', ...p), 'utf8');
const tools = src('lib/browser-tools.ts');
const agent = src('hooks/use-browser-agent.ts');
const surface = src('components/surfaces/browser/browser-surface.tsx');

/** Tools the agent hook intercepts rather than running against the webview. */
const HOOK_HANDLED = new Set(['new_tab', 'close_tab', 'switch_tab']);
/** `done` terminates the loop; it has no executor branch by design. */
const LOOP_CONTROL = new Set(['done']);

const names = BROWSER_TOOL_SCHEMAS.map((t) => t.name);

describe('the tool list is coherent', () => {
  it('found the schemas', () => {
    // Without this an empty import makes every check below vacuous.
    expect(names.length).toBeGreaterThanOrEqual(18);
    expect(new Set(names).size, `duplicate tool name: ${names}`).toBe(names.length);
  });

  it('BROWSER_TOOL_NAMES matches the schemas', () => {
    // Two lists of the same thing drift; this is the cheap half of preventing it.
    expect([...BROWSER_TOOL_NAMES].sort()).toEqual([...names].sort());
  });

  it.each(names.filter((n) => !HOOK_HANDLED.has(n) && !LOOP_CONTROL.has(n)))(
    '%s has an executor branch',
    (name) => {
      expect(tools, `${name} is declared but executeToolInWebview has no case for it`).toContain(
        `case '${name}'`,
      );
    },
  );

  it.each([...HOOK_HANDLED])('%s is intercepted by the agent hook', (name) => {
    expect(agent, `${name} is declared but the hook never handles it`).toContain(`'${name}'`);
  });
});

describe('tab tools are wired all the way to the surface', () => {
  /*
   * The layer that was missing. A handler that calls an optional callback which
   * nobody provides fails at runtime with a polite message and looks, from the
   * model's side, exactly like the capability not existing.
   */
  it.each([
    ['onNewTab', 'handleNewTab'],
    ['onCloseTab', 'handleCloseTab'],
    ['onSwitchTab', 'handleSwitchTab'],
  ])('%s is passed from the browser surface', (option, handler) => {
    expect(agent, `${option} is not declared on UseBrowserAgentOptions`).toContain(option);
    expect(surface, `${option} is never passed to useBrowserAgent`).toContain(`${option}: ${handler}`);
    expect(surface, `${handler} is not defined in the surface`).toContain(`const ${handler}`);
  });

  it('new_tab opens in the BACKGROUND, keeping the agent on its page', () => {
    /*
     * Stealing focus per tab would leave the agent observing a different page
     * from the one it is reasoning about — the same drift the tool exists to
     * fix, self-inflicted.
     */
    expect(surface).toMatch(/addTab\(\{[^}]*isActive:\s*false/);
  });

  it('new_tab refuses non-http schemes', () => {
    // A tool that opens any scheme on request will open file:// on request.
    expect(agent).toMatch(/protocol !== 'http:' && .*protocol !== 'https:'/);
  });

  it('close_tab will not close the last tab', () => {
    expect(agent).toContain('Refusing to close the only tab');
  });
});

describe('the model is told the tabs exist', () => {
  it('the tab-list hint names the tools it can use', () => {
    // The hint used to mention switch_tab only, which is a fair summary of a
    // world with no new_tab in it.
    expect(tools).toContain('new_tab');
    expect(tools).toMatch(/Use new_tab .* switch_tab .* close_tab/);
  });
});
