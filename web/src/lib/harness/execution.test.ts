import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The harness must not resolve its own model, and must resolve credentials.
 *
 * Both of these were found by RUNNING a goal rather than by testing one. The
 * first attempt died at the planner with
 *
 *   "planning failed: Claude Code returned an error result: Not logged in ·
 *    Please run /login"
 *
 * because both routes called `provider.query` with `surfaceConfig.model` and no
 * key at all. Every other path resolves one; these two never had.
 *
 * The second problem would have outlived the first and been much harder to see.
 * A caller that resolves its own model instead of taking the client's
 * `resolveSendRoute` answer resolves against the BUILT-IN Anthropic registry and
 * then demands an Anthropic key — so for an OpenRouter-only user the whole
 * feature is dead while everything else works. The browser surface shipped
 * exactly that for months. `send-route-coverage.test.ts` derives its sets from
 * the SURFACE list, and a route is not a surface, so nothing caught the repeat.
 */
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'src', ...p), 'utf8');
const start = read('app', 'api', 'harness', 'route.ts');
const init = read('app', 'api', 'harness', 'init', 'route.ts');
const routes = [
  ['start', start],
  ['init', init],
] as const;

describe('harness routes take the client’s resolved route', () => {
  it.each(routes)('%s accepts a model from the request', (_name, src) => {
    expect(src).toMatch(/body\.model/);
  });

  it.each(routes)('%s accepts a providerConfig', (_name, src) => {
    // Without this a user-added provider is unreachable and the run demands an
    // Anthropic key regardless of what Settings says.
    expect(src).toContain('providerConfig');
  });

  it.each(routes)('%s resolves execution rather than guessing', (_name, src) => {
    expect(src).toContain('resolveHarnessExecution');
  });

  it.each(routes)('%s passes the resolved key to EVERY provider query', (_name, src) => {
    /*
     * Per query block, not per file. Asserting the file merely CONTAINS
     * `apiKey: exec.apiKey` was vacuous: deleting it from the executor left the
     * verifier's copy satisfying the assertion, and the sabotage passed. The
     * failure being prevented — "Not logged in · Please run /login" — happens on
     * whichever query is missing it.
     */
    const blocks = [...src.matchAll(/provider\.query\(\{[\s\S]*?\n {6}\}\)/g)].map((m) => m[0]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).toContain('apiKey: exec.apiKey');
      expect(block).toContain('baseUrl: exec.baseUrl');
      expect(block).toContain('providerEnv: exec.providerEnv');
    }
  });

  it.each(routes)('%s does not query with the surface default model', (_name, src) => {
    /*
     * `surfaceConfig.model` may only be the LAST-resort fallback handed to
     * `resolveHarnessExecution`, never the model a query runs on — that is the
     * bypass itself.
     */
    expect(src).not.toMatch(/model:\s*surfaceConfig\.model/);
  });

  it('the verifier runs on the same resolved model as the executor', () => {
    // A cheaper verifier that misses things turns an honest "unverified" into a
    // false "verified".
    // Only the model each `provider.query` RUNS on — not the route handed to
    // resolveHarnessExecution, which is a different `model:` and legitimately
    // the client's value.
    const queryBlocks = [...start.matchAll(/provider\.query\(\{[\s\S]*?\n {6}\}\)/g)].map((m) => m[0]);
    expect(queryBlocks.length).toBe(2); // executor and verifier
    for (const block of queryBlocks) {
      expect(block).toContain('model: exec.model');
    }
  });
});
