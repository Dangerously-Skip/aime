import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * What `allowedTools` actually is, written down because I got it wrong.
 *
 * It is an AUTO-APPROVE list, not an allow list — absence does not withhold a
 * tool. Two pieces of evidence, one of them from trying to claim otherwise:
 * `CLAUDE.md` records that `WidgetCreate` "is on none of them and works
 * everywhere", and this session's own log shows `mcp__aime__MailSearch` being
 * called on the Chat surface while absent from that surface's list.
 *
 * I briefly wrote a test asserting every registered tool must appear on some
 * surface, and it failed on six tools that demonstrably work — CronCreate, the
 * three Excel tools, StandingOrderCreate and WidgetCreate. The test was wrong,
 * not the code, and it is deleted rather than "fixed" by listing six tools to
 * satisfy a premise that is false.
 *
 * Listing a tool is still worth doing: on any permission mode other than
 * bypass, an unlisted tool prompts. That is the property asserted here — hygiene
 * with a real consequence, not a gate.
 */

const SURFACE_DIR = path.resolve(process.cwd(), 'src/lib/surfaces');
const surfaces = () =>
  fs
    .readdirSync(SURFACE_DIR)
    .filter((f) => f.endsWith('-config.ts'))
    .map((f) => ({
      name: f.replace('-config.ts', ''),
      src: fs.readFileSync(path.join(SURFACE_DIR, f), 'utf-8'),
    }));

/**
 * The replacement for the denied built-in. `WebFetch` is in `deniedTools`, so a
 * surface that lists the old name and not the new one is auto-approving a tool
 * that cannot run while making the working one prompt.
 */
describe('the fetch replacement is listed wherever the built-in was', () => {
  it('every surface that lists WebFetch also lists FetchUrl', () => {
    const offenders = surfaces()
      .filter((s) => s.src.includes("'WebFetch'") && !s.src.includes('mcp__aime__FetchUrl'))
      .map((s) => s.name);
    expect(offenders, 'these auto-approve a denied tool and prompt for the live one').toEqual([]);
  });

  it('the built-in is genuinely denied, so the swap matters', () => {
    const provider = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/providers/claude-provider.ts'),
      'utf-8',
    );
    const deny = /const denied = new Set<string>\(\[[\s\S]{0,2000}?\]\);/.exec(provider)?.[0] ?? '';
    expect(deny).toMatch(/'WebFetch'/);
  });
});

/**
 * AN AIME TOOL MUST BE LISTED BY ITS REAL NAME.
 *
 * The in-process MCP server is called `aime`, so the SDK knows its tools as
 * `mcp__aime__StandingOrderCreate`. The Assistant surface listed five of them
 * bare — `'StandingOrderCreate'` — which matches nothing, so its OWN core tools
 * were never auto-approved.
 *
 * That is invisible on four of the five surfaces, because they run `acceptEdits`
 * or `bypassPermissions` and an unlisted tool is allowed anyway. The Assistant
 * is the one on `permissionMode: 'default'`, where an unlisted tool PROMPTS —
 * so the mistake only has consequences exactly where it was made. Asked for a
 * daily-goals checklist widget, the model reported "both calls hit a permission
 * issue", fell back to `CronCreate`, and retried: three duplicate standing
 * orders and no widget.
 *
 * Derived from the provider rather than hardcoded, so a tool added to the
 * server is covered without anyone remembering this file exists.
 */
describe('aime MCP tools are listed by their prefixed name', () => {
  const provider = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/providers/claude-provider.ts'),
    'utf-8',
  );

  /** Every tool registered on the in-process `aime` server. */
  const registered = (): string[] => {
    const start = provider.indexOf('createSdkMcpServer({');
    expect(start, 'the aime MCP server moved').toBeGreaterThan(-1);
    const body = provider.slice(start);
    return [...new Set([...body.matchAll(/\(tool as any\)\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g)].map((m) => m[1]))];
  };

  it('finds the server and its tools', () => {
    // Without this the checks below pass by matching nothing.
    const names = registered();
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain('StandingOrderCreate');
    expect(names).toContain('WidgetCreate');
  });

  it('no surface lists one of them unprefixed', () => {
    const names = registered();
    const offenders: string[] = [];

    for (const s of surfaces()) {
      // Only the strings inside `allowedTools`, so prose in a system prompt
      // naming a tool is not mistaken for a listing.
      const list = /allowedTools:\s*\[([\s\S]*?)\]/.exec(s.src)?.[1] ?? '';
      const listed = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      for (const bare of listed) {
        if (names.includes(bare)) offenders.push(`${s.name}: '${bare}' should be 'mcp__aime__${bare}'`);
      }
    }

    expect(offenders, 'these match no tool, so they auto-approve nothing').toEqual([]);
  });

  it('the Assistant can create the things it exists to create', () => {
    /*
     * Specific, because this surface is the only one where being unlisted
     * costs anything — and because "schedule a reminder" and "pin a widget"
     * are the two things a user comes to it for.
     */
    const assistant = surfaces().find((s) => s.name === 'assistant')!;
    for (const tool of ['StandingOrderCreate', 'WidgetCreate']) {
      expect(assistant.src, `the Assistant cannot auto-approve ${tool}`).toContain(
        `mcp__aime__${tool}`,
      );
    }
  });

  it('the Assistant is still the surface where this matters', () => {
    // If it ever moves to bypassPermissions the above stops being load-bearing,
    // and someone should notice here rather than discover it in a bug report.
    const assistant = surfaces().find((s) => s.name === 'assistant')!;
    expect(assistant.src).toMatch(/permissionMode:\s*'default'/);
  });
});
