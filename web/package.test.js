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

describe('the Agent SDK version is one number', () => {
  // release.yml force-installs the platform binaries by exact version (npm ci
  // on one OS skips the other OSes' optional packages). A pin left behind by an
  // upgrade ships a CLI binary from a different SDK than the JS that drives it.
  it('is pinned exactly, and every release.yml binary install names it', () => {
    const want = pkg.dependencies['@anthropic-ai/claude-agent-sdk'];
    expect(want).toMatch(/^\d+\.\d+\.\d+$/);
    const release = readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf-8');
    const pins = [...release.matchAll(/@anthropic-ai\/claude-agent-sdk-[\w-]+@([^\s'"]+)/g)].map((m) => m[1]);
    expect(pins.length).toBeGreaterThan(0);
    expect(new Set(pins)).toEqual(new Set([want]));
  });

  // 0.3 moved these to peerDependencies; the app imports zod itself.
  it.each(['@anthropic-ai/sdk', '@modelcontextprotocol/sdk', 'zod'])('%s is a direct dependency', (name) => {
    expect(pkg.dependencies[name]).toBeDefined();
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

describe('sharp is past the libvips/libheif advisories', () => {
  // GHSA-f88m-g3jw-g9cj and GHSA-rgj7-g3m4-5g8c (high) affect sharp <= 0.35.4-rc.0.
  // Nothing here imports sharp: it arrives through @huggingface/transformers
  // (Whisper) and as next's optional image optimiser. transformers 3.x pinned it
  // to ^0.34, which is what kept the advisory open; 4.3.0 takes ^0.35.4. Checked
  // across the whole lockfile, because a NESTED old copy is exactly what a
  // dependency still pinning the old range would leave behind.
  const lock = JSON.parse(readFileSync(path.join(__dirname, 'package-lock.json'), 'utf-8'));
  const atLeast = (version, [maj, min, patch]) => {
    const [a, b, c] = version.split(/[.-]/).map((n) => parseInt(n, 10));
    return a > maj || (a === maj && (b > min || (b === min && c >= patch)));
  };

  it('every sharp in the lockfile is >= 0.35.4, and not a prerelease of it', () => {
    const copies = Object.entries(lock.packages).filter(
      ([key]) => key === 'node_modules/sharp' || key.endsWith('/node_modules/sharp'),
    );
    expect(copies.length).toBeGreaterThan(0);
    for (const [key, entry] of copies) {
      expect(atLeast(entry.version, [0, 35, 4]), `${key}@${entry.version}`).toBe(true);
      expect(entry.version, key).not.toMatch(/^0\.35\.4-/);
    }
  });

  it('@huggingface/transformers is on 4.3.0 or later, the first release that allows a fixed sharp', () => {
    expect(pkg.dependencies['@huggingface/transformers']).toMatch(/^\^4\./);
    expect(atLeast(lock.packages['node_modules/@huggingface/transformers'].version, [4, 3, 0])).toBe(true);
  });
});
