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
