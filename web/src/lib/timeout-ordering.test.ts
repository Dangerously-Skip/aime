import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * What is allowed to kill a turn, and in what order.
 *
 * There were four such timeouts, on two sides of a network boundary, and nothing
 * related them to each other. The asymmetry nobody had written down: **only the
 * server side can stop the agent.** A client-side abort tears down a `fetch`,
 * and the SDK subprocess runs on to completion — spending tokens on a stream
 * with no reader, writing files whose `tool_use` events have nowhere to go.
 *
 * So the client killing a turn first does not end the work; it only stops anyone
 * seeing it. That is what shipped: a client watchdog fired at 120s over a
 * WebFetch that returned at 120.5s, and the agent went on to finish an 18-slide
 * deck half a minute later, into a UI already saying it was stuck and to retry.
 *
 * Two of the four are now gone. The client stuck-tool watchdog was deleted — it
 * duplicated the server's per-tool deadline across the wire, could not act on
 * what it observed, and had none of the four `awaitingHuman` exemptions the
 * server's has, so it also counted a user thinking about an AskUserQuestion as a
 * hung tool. What remains:
 *
 *   server tool deadline  <  server query timeout       (both real stops)
 *   client SSE inactivity                               (a dead connection only)
 *
 * The consequence this file has to guard: with the client watchdog gone,
 * `queryTimeoutSecs` is the ONLY thing that ends a turn whose tools never report
 * back on a live connection — heartbeats keep flowing from a separate interval,
 * so the inactivity timer never fires. A surface that omits it, or sets it to 0,
 * has no backstop at all.
 */

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');

/** Pull a numeric constant out of source, so the test tracks the real value. */
function constant(source: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*([0-9_]+)`).exec(source);
  if (!match) throw new Error(`${name} not found — has it been renamed?`);
  return Number(match[1].replace(/_/g, ''));
}

const providerSrc = read('providers/claude-provider.ts');
const TOOL_DEADLINE_MS = constant(providerSrc, 'TOOL_DEADLINE_MS');

/**
 * Every surface config, INCLUDING any that declares no timeout — `secs: null` is
 * the case that most needs failing, so it must not be filtered away here. A
 * surface omitting the field reads as 0 at the route and arms no timer at all.
 */
const surfaceDir = path.resolve(__dirname, 'surfaces');
const queryTimeouts = fs
  .readdirSync(surfaceDir)
  .filter((f) => f.endsWith('-config.ts'))
  .map((f) => {
    const match = /queryTimeoutSecs:\s*(\d+)/.exec(fs.readFileSync(path.join(surfaceDir, f), 'utf-8'));
    return { surface: f.replace('-config.ts', ''), secs: match ? Number(match[1]) : null };
  });

/** Only for the ordering comparisons, which need a number to compare against. */
const declared = queryTimeouts.filter(
  (s): s is { surface: string; secs: number } => s.secs !== null,
);

describe('the timeout hierarchy', () => {
  it('finds the surface configs at all', () => {
    expect(queryTimeouts.length, 'no surface configs parsed — has the shape changed?')
      .toBeGreaterThanOrEqual(4);
  });

  /**
   * One slow tool must not cost the whole turn while the turn still has budget.
   */
  it.each(declared)(
    'the per-tool deadline fires before $surface gives up on the query',
    ({ secs }) => {
      expect(TOOL_DEADLINE_MS).toBeLessThan(secs * 1000);
    },
  );

  /**
   * Now load-bearing in a way it was not before. While the client had its own
   * watchdog, a surface with `queryTimeoutSecs: 0` still got killed eventually —
   * badly, from the wrong side, but killed. Nothing covers that surface now:
   * the route reads `surfaceConfig.queryTimeoutSecs || 0` and simply arms no
   * timer, and heartbeats keep the client's inactivity timer alive indefinitely.
   * The turn would hang until the user reloaded.
   */
  it.each(queryTimeouts)('$surface sets a non-zero query timeout', ({ secs }) => {
    expect(
      secs ?? 0,
      'this surface has no backstop — a hung turn there never ends',
    ).toBeGreaterThan(0);
  });

  /**
   * The deadline has to clear the tools it exists to police. WebFetch's
   * summarization step is the known slow one — an observed call returned at
   * 120.5s, correct and complete.
   */
  it('allows a slow-but-legitimate WebFetch to finish', () => {
    expect(TOOL_DEADLINE_MS).toBeGreaterThan(120_500);
  });

  it('still bounds a genuine hang rather than waiting for the query timeout', () => {
    const shortest = Math.min(...declared.map((q) => q.secs * 1000));
    expect(TOOL_DEADLINE_MS).toBeLessThan(shortest);
  });
});

/**
 * The other half of the same defect: ordering only helps if the client's give-up
 * reaches the server at all. It did not — `POST /api/abort` existed, was tested,
 * and no client called it, while the chat route ignored `req.signal` entirely.
 */
describe('a client that disconnects stops the agent', () => {
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../app/api/chat/[surfaceId]/route.ts'),
    'utf-8',
  );

  it('the chat route listens for the request being aborted', () => {
    expect(
      routeSrc,
      'no req.signal listener — a disconnected client leaves the agent running',
    ).toMatch(/req\.signal\.addEventListener\(\s*['"]abort['"]/);
  });

  it('and aborts the provider when it fires, not merely logs it', () => {
    const handler = /req\.signal\.addEventListener\([\s\S]{0,600}/.exec(routeSrc)?.[0] ?? '';
    expect(handler, 'the listener does not call provider.abort').toMatch(/provider\.abort\(/);
  });
});
