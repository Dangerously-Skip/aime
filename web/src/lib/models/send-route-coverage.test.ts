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

const COMPONENTS = path.resolve(__dirname, '../../components');

/** Anything that kicks off a model turn from the UI. */
const STARTS_A_TURN = /\b(sendMessage|runAgentLoop)\(/;
const USES_CHOKEPOINT = /\bresolveSendRoute\(/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const files = sourceFiles(COMPONENTS).map((file) => ({
  rel: path.relative(COMPONENTS, file),
  text: fs.readFileSync(file, 'utf-8'),
}));

describe('every turn-starting surface goes through the model-route chokepoint', () => {
  const starters = files.filter((f) => STARTS_A_TURN.test(f.text));

  it('finds the surfaces (so this test cannot pass by matching nothing)', () => {
    // Without this, deleting the regexes above would leave a green suite that
    // asserts about an empty set — the failure mode the security enforcement
    // test exists to prevent.
    expect(starters.length).toBeGreaterThanOrEqual(5);
    expect(starters.map((f) => f.rel)).toContain(
      path.join('surfaces', 'browser', 'browser-surface.tsx'),
    );
  });

  it.each(
    files.filter((f) => STARTS_A_TURN.test(f.text)).map((f) => [f.rel, f.text] as const),
  )('%s resolves its route through resolveSendRoute', (rel, text) => {
    expect(
      USES_CHOKEPOINT.test(text),
      `${rel} starts a turn but never calls resolveSendRoute, so the user's ` +
        `tier-grid selection and BYOK providers do not govern it. Resolve the ` +
        `route there and send its model + providerConfig.`,
    ).toBe(true);
  });
});
