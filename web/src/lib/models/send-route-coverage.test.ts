import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every surface that starts a turn must route it through `resolveSendRoute`.
 *
 * That function is the single chokepoint where the user's Settings actually take
 * effect — the tier grid picks which model fills each slot, and BYOK providers
 * (OpenRouter, a local Ollama, anything user-added) are only reachable through
 * the route it returns. A surface that skips it does not run "a slightly
 * different model"; it runs against the BUILT-IN Anthropic registry and then
 * demands an Anthropic key. For an OpenRouter-only user that surface is simply
 * dead, while every other one works.
 *
 * `resolveSendRoute`'s own comment already warned about this:
 *
 *   "Done here rather than in each surface, because all four call this function
 *    and one forgetting is how the gap appeared."
 *
 * Four was wrong. The browser surface was the fifth, and it had forgotten —
 * silently, because prose in a comment cannot fail a build. This test is that
 * sentence made executable: it derives BOTH sets from source, so a new surface
 * added tomorrow is covered without anyone remembering to add it here.
 */

const SRC = path.resolve(__dirname, '../..');

/** Anything that kicks off a model turn from the UI. */
const STARTS_A_TURN = /\b(sendMessage|runAgentLoop|useSurfaceTurn)\(/;
const USES_CHOKEPOINT = /\bresolveSendRoute\(/;

/**
 * The shared turn Chat, Cowork, Code and Browser all use. It resolves the route
 * itself and a surface cannot hand it a model — only its picker's selection —
 * so a surface that sends ONLY through it is covered by it. What would not be
 * covered: a surface that also sends directly, or runs a local loop on a route
 * it did not get from the turn. Both are checked below.
 */
const SHARED_TURN = path.join('hooks', 'use-surface-turn.tsx');
const VIA_SHARED_TURN = /\buseSurfaceTurn\(/;

/**
 * A hand-rolled POST to the main chat route is ALSO starting a turn — and the
 * assistant surface shipped exactly that: `fetch('/api/chat/assistant')` with a
 * hardcoded model, matching neither regex above, so the tier grid never
 * governed it and a BYOK-only user had a dead surface. This pattern catches the
 * shape itself.
 *
 * The static subroutes under /api/chat are NOT turn starts: `answer`,
 * `connector-result`, `document-result`, `browser-tool-result` relay an ANSWER
 * back into a parked turn, and `browser-turn` is the browser quick-loop with
 * its own route contract. Only paths that name a surface (or hit the dynamic
 * `[surfaceId]` route) count here.
 */
const CHAT_FETCH_PATHS = /fetch\(\s*['"`](\/api\/chat\/[^'"`]*)['"`]/g;
/**
 * Relay subroutes, spelled out. A `-result` SUFFIX rule was tried and rejected:
 * it silently exempted any future turn-starting route that happened to end in
 * `-result`, the same silent-widening failure mode as a deleted assertion.
 */
const RELAY_SUBROUTES = ['answer', 'browser-turn', 'browser-tool-result', 'connector-result', 'document-result'];

function rawChatFetches(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(CHAT_FETCH_PATHS)) {
    const sub = match[1].slice('/api/chat/'.length).replace(/\$\{[^}]*\}/g, 'x');
    if (RELAY_SUBROUTES.some((r) => sub === r || sub.startsWith(`${r}?`))) continue;
    out.push(match[1]);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const files = [
  ...sourceFiles(path.join(SRC, 'components')),
  ...sourceFiles(path.join(SRC, 'hooks')),
  ...sourceFiles(SRC),
  ...sourceFiles(path.join(SRC, 'stores')),
]
  // SRC itself re-walks lib/ (this file's tree), which already came in above —
  // dedupe by path so each file is judged once.
  .filter((file, i, all) => all.indexOf(file) === i)
  .map((file) => ({
    rel: path.relative(SRC, file),
    text: fs.readFileSync(file, 'utf-8'),
  }));

/**
 * Files allowed to POST to the main chat route without calling the chokepoint
 * THEMSELVES — each receives its route as an argument from a caller that did
 * resolve it. An entry without this justification would be a hole, not a
 * dispensation.
 */
const ROUTE_PASSED_IN = [
  'hooks/use-sse-stream.ts', // the shared transport every surface's sendMessage calls
];

describe('every turn-starting surface goes through the model-route chokepoint', () => {
  const starters = files.filter((f) => STARTS_A_TURN.test(f.text));

  it('finds the surfaces (so this test cannot pass by matching nothing)', () => {
    // Without this, deleting the regexes above would leave a green suite that
    // asserts about an empty set — the failure mode the security enforcement
    // test exists to prevent.
    expect(starters.length).toBeGreaterThanOrEqual(5);
    expect(starters.map((f) => f.rel)).toContain(
      path.join('components', 'surfaces', 'browser', 'browser-surface.tsx'),
    );
  });

  it.each(
    files.filter((f) => STARTS_A_TURN.test(f.text)).map((f) => [f.rel, f.text] as const),
  )('%s resolves its route through resolveSendRoute', (rel, text) => {
    if (rel !== SHARED_TURN && VIA_SHARED_TURN.test(text) && !USES_CHOKEPOINT.test(text)) {
      expect(text, `${rel} uses the shared turn but also sends directly, bypassing its route`).not.toMatch(
        /\bsendMessage\(/,
      );
      // A local loop (Browser's page questions) runs on the route the turn resolved.
      for (const call of text.match(/\brunAgentLoop\([^;]*/g) ?? []) {
        expect(call, `${rel} runs a local loop on a route it did not get from the turn`).toMatch(
          /\broute\?\.providerConfig\b/,
        );
      }
      return;
    }
    expect(
      USES_CHOKEPOINT.test(text),
      `${rel} starts a turn but never calls resolveSendRoute, so the user's ` +
        `tier-grid selection and BYOK providers do not govern it. Resolve the ` +
        `route there and send its model + providerConfig.`,
    ).toBe(true);
  });

  it('the shared turn sends the route it resolved, and takes no model from a surface', () => {
    const hook = files.find((f) => f.rel === SHARED_TURN)?.text ?? '';
    expect(hook, `${SHARED_TURN} not found`).not.toBe('');
    expect(hook).toMatch(USES_CHOKEPOINT);
    // The model it sends is the route's (or a dispatch's explicit override of it)…
    expect(hook).toMatch(/:\s*\(route\?\.model \?\? null\)/);
    expect(hook).toMatch(/providerConfig:\s*route\?\.providerConfig/);
    // …and its config accepts a picker SELECTION, never a model name.
    const config = /export interface SurfaceTurnConfig \{[\s\S]*?\n\}/.exec(hook)?.[0] ?? '';
    expect(config).toMatch(/\bmodelRoute: ModelOption \| null;/);
    expect(config).not.toMatch(/^\s*model\??:/m);
  });

  it('still finds the assistant surface as a turn starter', () => {
    // The regression this half exists for: the assistant once hand-rolled
    // `fetch('/api/chat/assistant')` with a hardcoded model. It streams through
    // useSSEStream now, so it is a `sendMessage(` starter — and is therefore
    // held to the chokepoint by the check above rather than slipping past both.
    const assistant = files.find((f) => f.rel.endsWith('surfaces/assistant/assistant-surface.tsx'))?.text ?? '';
    expect(assistant).toMatch(/\bsendMessage\([^)]*['"`]assistant['"`]/);
    expect(STARTS_A_TURN.test(assistant)).toBe(true);
    expect(USES_CHOKEPOINT.test(assistant)).toBe(true);
  });

  it.each(
    files.filter((f) => rawChatFetches(f.text).length > 0).map((f) => [f.rel, f.text] as const),
  )('%s resolves its raw chat POST through resolveSendRoute', (rel, text) => {
    if (ROUTE_PASSED_IN.some((allowed) => rel.endsWith(allowed))) {
      return; // covered by the caller; see the allowlist comment
    }
    expect(
      USES_CHOKEPOINT.test(text),
      `${rel} POSTs to /api/chat/${rawChatFetches(text)[0].slice('/api/chat/'.length)} ` +
        `directly without resolving a route. A hand-rolled body skips the user's ` +
        `tier grid and BYOK providers — resolve through resolveSendRoute and send ` +
        `its model + providerConfig.`,
    ).toBe(true);
  });

  it('the route-passed-in allowlist stays honest', () => {
    // A stale allowlist entry hides a file that no longer exists or no longer
    // needs the exemption — the same silent-widening failure mode as a deleted
    // assertion.
    for (const allowed of ROUTE_PASSED_IN) {
      const file = files.find((f) => f.rel === allowed);
      expect(file, `${allowed} listed but not found`).toBeDefined();
      expect(rawChatFetches(file!.text).length).toBeGreaterThan(0);
    }
  });
});

/**
 * A subagent run is a turn too. `/api/subagent` accepts `model` + `providerConfig`
 * precisely so it can follow the user's route; a caller that omits them gets
 * the built-in Anthropic registry, which for an OpenRouter-only user means a
 * PR button and canvas writebacks that can never work.
 */
describe('every /api/subagent caller sends a resolved route', () => {
  const SUBAGENT_FETCH = /fetch\(\s*['"`]\/api\/subagent['"`]/;
  const callers = files.filter((f) => SUBAGENT_FETCH.test(f.text));

  it('finds the callers (so this cannot pass by matching nothing)', () => {
    expect(callers.map((f) => f.rel)).toEqual(
      expect.arrayContaining([
        path.join('components', 'surfaces', 'code', 'workspace', 'branch-header.tsx'),
        path.join('lib', 'canvas', 'dispatch.ts'),
      ]),
    );
  });

  it.each(callers.map((f) => [f.rel, f.text] as const))(
    '%s resolves through resolveSendRoute and sends providerConfig',
    (rel, text) => {
      expect(USES_CHOKEPOINT.test(text), `${rel} POSTs to /api/subagent without resolving a route`).toBe(true);
      expect(text, `${rel} resolves a route but never sends providerConfig`).toMatch(/providerConfig/);
    },
  );
});
