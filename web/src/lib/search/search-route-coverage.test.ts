import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SEARCH_PROVIDERS } from './providers';

/**
 * `resolveSearchRoute` must stay the only way anything learns whether search
 * exists.
 *
 * This is `send-route-coverage.test.ts` for the search layer, and it exists for
 * the same reason that one does — except here the failure already happened.
 * Three modules read `process.env.SEARXNG_INSTANCES` independently:
 *
 *   - `claude-provider`      mounted the MCP when it was set
 *   - `hasWebSearchMcp()`    reported availability when it was set
 *   - `search-proxy/route`   fell back to a hardcoded internal host
 *
 * The third disagreed with the other two. The route claimed a search engine the
 * prompt had just told the model did not exist, then DNS-failed off that
 * network and returned `{results: []}` — which reads as "the web contains
 * nothing about your query". The user watched the agent give up on searching and
 * start reciting URLs from memory instead.
 *
 * Prose in a comment could not have stopped that. This can.
 */

const SRC = path.resolve(__dirname, '../..');

/** Files allowed to name the env var: the resolver, and docs about it. */
const ENV_READERS_ALLOWED = [
  path.join(SRC, 'lib/search/resolve.ts'),
  path.join(SRC, 'lib/search/execute.ts'),
];

const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/i;

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !IS_TEST.test(e.name) ? [full] : [];
  });
}

describe('search resolves through one chokepoint', () => {
  const files = sourceFiles(SRC);

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  /**
   * The load-bearing assertion. A new caller that reads the env var directly is
   * a new module that can disagree with the prompt — exactly the bug above.
   */
  it('nothing but the resolver reads SEARXNG_INSTANCES', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ENV_READERS_ALLOWED.includes(f)) continue;
      const text = fs.readFileSync(f, 'utf-8');
      text.split('\n').forEach((line, i) => {
        // Comments explaining the history are fine; a read is not.
        if (/process\.env\.SEARXNG_INSTANCES/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
          offenders.push(`${path.relative(SRC, f)}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      `these read the search env var directly instead of calling ` +
        `resolveSearchRoute(), so they can disagree with the system prompt:\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  /**
   * Every provider in the catalog must be handled by the executor. A preset with
   * no branch is a provider the user can select in Settings and that then
   * silently returns nothing — the "configured but broken" state this whole
   * subsystem exists to make impossible.
   */
  it('every catalogued provider has an executor branch', () => {
    const exec = fs.readFileSync(path.join(SRC, 'lib/search/execute.ts'), 'utf-8');
    for (const p of SEARCH_PROVIDERS) {
      expect(exec, `no executor branch for '${p.id}'`).toMatch(
        new RegExp(`case '${p.id}':`),
      );
    }
  });

  it('every catalogued provider states what it requires', () => {
    for (const p of SEARCH_PROVIDERS) {
      expect(p.requires.length, `${p.id} requires nothing — it can never be unconfigured`).toBeGreaterThan(0);
      expect(p.description.length, `${p.id} has no description for Settings`).toBeGreaterThan(30);
    }
  });
});
