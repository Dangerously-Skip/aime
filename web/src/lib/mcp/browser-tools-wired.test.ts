import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getBrowserConfig } from '@/lib/surfaces/browser-config';
import { getCodeConfig } from '@/lib/surfaces/code-config';

/*
 * The wiring, checked end to end from source — because every part of this path
 * existed before and the path did not.
 *
 * `BROWSER_TOOL_SCHEMAS` reached exactly one model. `canUseTool` had a branch
 * for browser tools, the route emitted `browser_tool_use`, the relay route
 * resolved a rendezvous. Three healthy pieces, no path, and nothing failed —
 * because nothing ever told the model the tools existed.
 */

const src = (...p: string[]) => readFileSync(resolve(__dirname, '../..', ...p), 'utf8');
const provider = src('lib/providers/claude-provider.ts');
const route = src('app/api/chat/[surfaceId]/route.ts');

describe('the tools reach the SDK', () => {
  it('the provider builds them onto the aime server', () => {
    expect(provider).toContain('buildIfServable');
    /*
     * Anchored on the CALL SITE, not the name. The first version sliced from
     * `indexOf('createSdkMcpServer')`, which finds the import on line 1 — so it
     * inspected the top of the file and failed against correct code.
     */
    const call = provider.indexOf('createSdkMcpServer({');
    expect(call, 'aime server call site not found — did it move?').toBeGreaterThan(0);
    expect(provider.slice(call, call + 400)).toContain('browserTools');
  });

  it('they are gated on a live webview, not on the surface', () => {
    /*
     * `onBrowserToolUse` is built for EVERY surface and Code's preview panel can
     * be closed, so either signal alone registers tools nothing can execute —
     * DR-21's infinite loop, one layer down.
     */
    /*
       Both signals, wherever the expression lives. It was inline at
       `hasWebview:` until the allow-list needed the same answer — permitting the
       tools and mounting them must not be able to disagree — so it became a
       named flag that both read. Asserted on the DEFINITION rather than on
       either use, so extracting it again does not fail this for no reason while
       dropping half the condition still does.
    */
    expect(provider).toMatch(
      /const browserToolsServable =\s*browserToolsAvailable === true && !!onBrowserToolUse/,
    );
    expect(provider).toContain('hasWebview: browserToolsServable');
  });

  it('the route requires a live stream AS WELL as a webview', () => {
    expect(route).toMatch(/browserToolsAvailable === true && canRelayToClient !== false/);
  });

  it('the flag is client-declared and defaults to OFF', () => {
    // Absent means absent. A default of true would arm every caller that has
    // never heard of this field, including /api/subagent.
    expect(route).toMatch(/browserToolsAvailable = false,/);
  });
});

describe('the Browser surface has a real agent now', () => {
  const browser = getBrowserConfig();

  it('gets the tools it had none of', () => {
    // 0 MCP, 0 connectors, 0 canvas, 0 memory, 0 skills was the finding.
    for (const t of ['Read', 'Write', 'Skill', 'AskUserQuestion', 'mcp__aime__SearchWeb']) {
      expect(browser.allowedTools, `Browser is still missing ${t}`).toContain(t);
    }
  });

  it('is comparable to Code rather than a stripped-down cousin', () => {
    const code = getCodeConfig();
    const missing = code.allowedTools.filter(
      (t) => !browser.allowedTools.includes(t) && !['Bash', 'NotebookEdit', 'EnterWorktree'].includes(t),
    );
    // Bash, NotebookEdit and EnterWorktree are Code's job, not a browser's.
    expect(missing, `Browser lacks tools Code has: ${missing}`).toEqual([]);
  });

  it('does NOT list browser tools itself', () => {
    // They arrive as mcp__aime__* from the bridge, only when servable. Listing
    // them here would be a second declaration that drifts.
    expect(browser.allowedTools.some((t) => t === 'navigate' || t === 'click')).toBe(false);
  });
});

describe('the prompt resolves the read-a-page collision', () => {
  const prompt = JSON.stringify(getBrowserConfig().systemPrompt);

  it('says not to fetch a page you are already on', () => {
    /*
     * The agent now holds WebFetch, FetchUrl, SearchWeb AND navigate. Without a
     * rule it will fetch the URL in its own address bar and get a different,
     * logged-out copy of it.
     */
    expect(prompt).toMatch(/[Nn]ever fetch a URL you are already looking at/);
  });

  it('says to write findings down as it goes', () => {
    // The whole point of the capability jump: the camera task failed because
    // findings across pages had nowhere to accumulate.
    expect(prompt).toMatch(/Write things down|belong in a file or a canvas/);
  });

  it('tells it to read the change summary and not repeat a dead action', () => {
    expect(prompt).toMatch(/NOTHING\s*\n?changed|Nothing changing after a click/);
  });

  it('tells it the element list is capped', () => {
    expect(prompt).toMatch(/not seen the whole page|scroll or page through/i);
  });
});
