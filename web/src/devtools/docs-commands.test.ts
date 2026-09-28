import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/*
 * The README's setup steps were wrong for months and nothing noticed: they
 * copied a `.env.example` that a fresh clone did not have, and described a
 * multi-provider registry as future work after it had shipped. Prose cannot be
 * fully checked, but the parts a newcomer types can be — the npm scripts, the
 * files they are told to copy or read, and the Node version.
 */

const repoRoot = resolve(__dirname, '../../..');
const DOCS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'web/README.md'];

const scripts = Object.keys(
  (JSON.parse(readFileSync(resolve(repoRoot, 'web/package.json'), 'utf8')) as { scripts: Record<string, string> })
    .scripts,
);

const read = (doc: string) => readFileSync(resolve(repoRoot, doc), 'utf8');

describe('contributor docs match the repo', () => {
  it.each(DOCS)('%s only names npm scripts that exist', (doc) => {
    const named = [...read(doc).matchAll(/npm run ([a-z][\w:-]*)/g)].map((m) => m[1]);
    expect(named.filter((s) => !scripts.includes(s))).toEqual([]);
  });

  it.each(DOCS)('%s links only to files that exist', (doc) => {
    const links = [...read(doc).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)].map((m) => m[1]);
    const base = dirname(resolve(repoRoot, doc));
    expect(links.filter((l) => !existsSync(resolve(base, l)))).toEqual([]);
  });

  it('the README copies an .env.example that exists where it says', () => {
    // The setup block runs `cd aime/web` before `cp .env.example .env`.
    expect(read('README.md')).toMatch(/cd aime\/web[\s\S]*cp \.env\.example \.env/);
    expect(existsSync(resolve(repoRoot, 'web/.env.example'))).toBe(true);
  });

  it('the documented Node version is the one .nvmrc pins', () => {
    const pinned = readFileSync(resolve(repoRoot, '.nvmrc'), 'utf8').trim().split('.')[0];
    for (const doc of ['README.md', 'CONTRIBUTING.md']) {
      expect(read(doc), doc).toMatch(new RegExp(`Node\\.js ${pinned}\\b`));
    }
  });
});
