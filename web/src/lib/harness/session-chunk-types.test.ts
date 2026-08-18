import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The session runner must listen for a chunk the provider actually emits.
 *
 * It listened for `type: 'done'`, which does not exist — the provider emits
 * `type: 'usage'`. So cost was always 0 and the budget stop condition, the only
 * limit that maps onto what a user cares about, never fired. A real goal run
 * finished two sessions with `spentUsd: 0`.
 *
 * Every unit test passed, because the fake provider in them emitted the invented
 * name rather than the real one. Reading the provider's source is the only thing
 * that would have caught it, so that is what this does.
 */
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'src', ...p), 'utf8');
const provider = read('lib', 'providers', 'claude-provider.ts');
const session = read('lib', 'harness', 'session.ts');

/** Chunk types the provider actually yields. */
function emittedTypes(): Set<string> {
  return new Set([...provider.matchAll(/type:\s*'([a-z_]+)'/g)].map((m) => m[1]));
}

describe('session chunk types', () => {
  it('found the provider’s chunk types, so this cannot pass on an empty set', () => {
    const types = emittedTypes();
    expect(types.size).toBeGreaterThan(3);
    expect(types).toContain('text');
  });

  it('every chunk type the session listens for is one the provider emits', () => {
    const listened = [...session.matchAll(/chunk\.type === '([a-z_]+)'/g)].map((m) => m[1]);
    expect(listened.length).toBeGreaterThan(0);
    const emitted = emittedTypes();
    for (const t of listened) {
      expect(emitted, `session listens for '${t}' but the provider never emits it`).toContain(t);
    }
  });

  it('reads usage from the chunk that carries it', () => {
    // The specific regression: cost silently zero.
    expect(session).toContain("chunk.type === 'usage'");
    expect(provider).toMatch(/type:\s*'usage'/);
  });
});
