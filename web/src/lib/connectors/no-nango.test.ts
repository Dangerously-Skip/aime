import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CONNECTOR_REGISTRY, CATEGORY_LABELS } from './registry';

/**
 * Nango was removed, and this is the guard that keeps it removed.
 *
 * It was half-built and invisible: four API routes, a bridge, a hook and a
 * catalogue, 2.8MB of dependencies, zero tests — and `buildNangoMcpServers`,
 * the function that was the entire point, was never called. Meanwhile the
 * sidebar polled `/api/nango/status` on every load for an answer that could
 * only ever be "not configured".
 *
 * It went because the problem it would solve had shrunk to almost nothing: 16
 * of the 17 catalogued MCP servers were verified doing Dynamic Client
 * Registration, which is one-click with no broker, no registration and no
 * per-call cost; the Microsoft connectors share a public client; GitHub can use
 * device flow; and Google is publish-unverified. A broker was left rescuing
 * roughly one connector.
 *
 * If it ever comes back it should be a decision with a reason attached, not a
 * dependency that drifts in — hence a test rather than a note.
 */
const SRC = path.resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('Nango is gone', () => {
  const files = walk(SRC).filter((f) => !f.endsWith('no-nango.test.ts'));

  it('has source files to search, so this test can fail', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  /*
   * Forbids a functional dependency — an import, an SDK, a call to its routes —
   * NOT the word. The first version of this failed on the two comments that
   * explain why Nango was removed, which are exactly the sentences a future
   * reader needs. A test that deletes its own rationale is the wrong test.
   */
  it('is imported, called or depended on nowhere in src', () => {
    const functional = /@nangohq|from ['"][^'"]*nango|\/api\/nango|require\(['"][^'"]*nango/i;
    const hits = files.filter((f) => functional.test(fs.readFileSync(f, 'utf-8')));
    expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('is still explained somewhere, so the removal has a reason attached', () => {
    const mentions = files.filter((f) => /nango/i.test(fs.readFileSync(f, 'utf-8')));
    expect(mentions.length, 'the rationale for removing it was deleted too').toBeGreaterThan(0);
  });

  it('is not a dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps).filter((d) => d.includes('nango'))).toEqual([]);
  });

  it('left no API routes behind', () => {
    expect(fs.existsSync(path.resolve(SRC, 'app/api/nango'))).toBe(false);
  });
});

/**
 * The category labels outlived Nango — they were always the registry's own
 * category union, so the browse view had been importing its labels from a
 * module about a service the app never used.
 */
describe('category labels moved with the registry', () => {
  it('labels every category the registry actually uses', () => {
    const used = new Set(CONNECTOR_REGISTRY.map((c) => c.category));
    for (const c of used) {
      expect(CATEGORY_LABELS[c], `${c} has no label`).toBeTruthy();
    }
  });

  it('has no label for a category nothing uses', () => {
    const used = new Set<string>(CONNECTOR_REGISTRY.map((c) => c.category));
    expect(Object.keys(CATEGORY_LABELS).filter((k) => !used.has(k))).toEqual([]);
  });
});
