import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);

/**
 * Dependency decisions that a routine `npm install <pkg>` or a bot PR would
 * quietly undo.
 */

const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const repoRoot = path.join(__dirname, '..');

describe('xlsx comes from SheetJS, not the npm registry', () => {
  // The registry's `xlsx` stopped at 0.18.5 with an unfixed prototype
  // pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9) — and it
  // parses user attachments. SheetJS publishes fixed builds only on its CDN.
  it('is pinned to the SheetJS CDN tarball', () => {
    expect(pkg.dependencies.xlsx).toMatch(/^https:\/\/cdn\.sheetjs\.com\/xlsx-\d+\.\d+\.\d+\/xlsx-\d+\.\d+\.\d+\.tgz$/);
  });

  it('the installed copy is 0.20.2 or later (the first build without both advisories)', () => {
    // xlsx's `exports` map hides package.json from require.resolve; read the file.
    const { version } = JSON.parse(readFileSync(path.join(__dirname, 'node_modules', 'xlsx', 'package.json'), 'utf-8'));
    const [maj, min, patch] = version.split('.').map(Number);
    expect(maj > 0 || min > 20 || (min === 20 && patch >= 2)).toBe(true);
  });
});

describe('next is past the critical advisories', () => {
  // GHSA-p293-qw3h-jr36 / GHSA-2xp9-vwfh-vxw4 affect next <= 16.3.2.
  it('installed next is >= 16.3.6', () => {
    const { version } = require_('next/package.json');
    const [maj, min, patch] = version.split('.').map((n) => parseInt(n, 10));
    expect(maj > 16 || (maj === 16 && (min > 3 || (min === 3 && patch >= 6)))).toBe(true);
  });

  it('eslint-config-next moves with it', () => {
    const want = require_('next/package.json').version;
    expect(pkg.devDependencies['eslint-config-next'].replace(/^[\^~]/, '')).toBe(want);
  });
});

describe('removed dependencies stay removed', () => {
  // Proven unused (no import/require anywhere in web/, scripts, mcp-servers or
  // configs) before removal. `dev-with-port.js` replaced concurrently + wait-on.
  it.each(['openai', 'dotenv', 'dockview-react', 'concurrently', 'wait-on'])('%s', (name) => {
    expect(pkg.dependencies?.[name]).toBeUndefined();
    expect(pkg.devDependencies?.[name]).toBeUndefined();
  });
});

describe('one Node version, everywhere', () => {
  it('engines, .nvmrc and every CI setup-node agree on 22', () => {
    expect(pkg.engines?.node).toBe('>=22');
    expect(readFileSync(path.join(repoRoot, '.nvmrc'), 'utf-8').trim()).toBe('22');
    const workflows = path.join(repoRoot, '.github', 'workflows');
    const versions = readdirSync(workflows)
      .filter((f) => f.endsWith('.yml'))
      .flatMap((f) => [...readFileSync(path.join(workflows, f), 'utf-8').matchAll(/node-version:\s*['"]?([^\s'"]+)/g)].map((m) => m[1]));
    expect(versions.length).toBeGreaterThan(0);
    expect(new Set(versions)).toEqual(new Set(['22']));
  });
});
