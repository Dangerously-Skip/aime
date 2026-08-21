import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { browserMcpToolNames, buildBrowserMcpTools, BROWSER_MCP_SERVER } from './browser-tool-bridge';
import { BROWSER_TOOL_SCHEMAS } from '../browser-tools';

/**
 * REGISTERING A TOOL IS NOT ENOUGH TO MAKE IT CALLABLE.
 *
 * The browser tools were mounted on the `aime` MCP server, the model was given
 * them, and it called them — and every call was refused before any handler ran,
 * because no permission rule covered the names. `canUseTool` is not consulted
 * for that refusal, so NOTHING IN THIS CODEBASE LOGGED IT. What it looked like:
 *
 *   - six `[Claude] Tool use: mcp__aime__navigate` lines
 *   - zero `browser_tool_use` events reaching the client
 *   - zero POSTs to /api/chat/browser-tool-result
 *   - zero `[SECURITY]` or `[Governance]` denials
 *   - an agent telling the user "there's a permission issue with the browser
 *     tools" and asking them to paste the URL of the page it was looking at
 *
 * The gap was a hand-written list: `browser-config.ts` names
 * `mcp__aime__FetchUrl` and `mcp__aime__SearchWeb` by hand, and nobody added the
 * browser tools when they were mounted. So the allow-list is now DERIVED, and
 * these tests hold the derivation to the registration.
 */

describe('the allow-list matches what is actually mounted', () => {
  /**
   * The load-bearing test. Any tool the model can see must be a tool it is
   * permitted to call — a mismatch in either direction is a silent failure.
   */
  it('names exactly the tools the bridge builds, one for one', () => {
    const built: string[] = [];
    buildBrowserMcpTools({
      tool: (name) => { built.push(`mcp__${BROWSER_MCP_SERVER}__${name}`); return {}; },
      emit: async () => {},
      newId: () => 'id',
    });
    expect(browserMcpToolNames().sort()).toEqual(built.sort());
  });

  it('carries the full server prefix the model sees', () => {
    // Bare `navigate` would look right in a diff and match nothing at runtime.
    for (const n of browserMcpToolNames()) expect(n).toMatch(/^mcp__aime__[a-z_]+$/);
  });

  it('covers every schema except the ones deliberately excluded', () => {
    const bare = browserMcpToolNames().map((n) => n.replace('mcp__aime__', ''));
    expect(bare).not.toContain('done'); // loop control for the local loop only
    for (const s of BROWSER_TOOL_SCHEMAS) {
      if (s.name === 'done') continue;
      expect(bare, `${s.name} is mounted but not permitted`).toContain(s.name);
    }
  });

  it('includes the verbs the reported failures needed', () => {
    // `navigate` is what the agent asked for six times; `new_tab` is the verb
    // whose absence caused DR-21's loop in the first place.
    const bare = browserMcpToolNames().map((n) => n.replace('mcp__aime__', ''));
    for (const v of ['navigate', 'click', 'extract_content', 'snapshot', 'new_tab']) {
      expect(bare).toContain(v);
    }
  });
});

describe('the provider permits them, and only when they are servable', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/providers/claude-provider.ts'),
    'utf8',
  );

  it('adds them to allowedTools', () => {
    const at = src.indexOf('const allowedTools = [');
    expect(at, 'allowedTools is no longer an array literal').toBeGreaterThan(-1);
    expect(src.slice(at, at + 2500)).toContain('browserMcpToolNames()');
  });

  it('gates that on the same flag that mounts them', () => {
    /*
     * Permitting a tool that is not mounted is harmless; MOUNTING one that is
     * not permitted is this bug. Both read the same `browserToolsServable`, so
     * they cannot disagree.
     */
    const at = src.indexOf('const allowedTools = [');
    expect(src.slice(at, at + 2500)).toMatch(/browserToolsServable \? browserMcpToolNames\(\) : \[\]/);
    expect(src).toContain('hasWebview: browserToolsServable');
  });

  it('does not let auto-approve outrank the user\'s own denials', () => {
    // `deniedTools` is the real restriction; auto-approve must sit below it.
    const at = src.indexOf('toolMatches(toolName, denied)');
    expect(at, 'the deny check is gone').toBeGreaterThan(-1);
  });
});
