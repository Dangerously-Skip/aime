import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * `web/.env.example` is the only configuration reference a new contributor
 * gets, and it drifted in both directions at once:
 *
 *   - It was gitignored (`web/.gitignore` had `.env*`), so a fresh clone had no
 *     such file and the README's `cp .env.example .env` failed outright. The
 *     complete one sat at the repo ROOT, where Next.js never reads a `.env`.
 *   - Variables the code read (AWS_BEARER_TOKEN_BEDROCK, MEMORY_EXTRACTION_MODEL,
 *     LOG_LEVEL, …) were documented nowhere, while ones it no longer read
 *     (NIB_COWORK_DEFAULT_MODEL, NANGO_*) were still advertised.
 *
 * So both directions are checked: every `process.env.X` read in `web/src` is
 * listed in the example, and every variable the example lists is named
 * somewhere in the tracked code.
 */

const webRoot = resolve(__dirname, '../..');
const EXAMPLE = resolve(webRoot, '.env.example');

/**
 * Read by the code but deliberately NOT in the example: set by the platform,
 * the toolchain, or a test harness — never by someone configuring AIME.
 * `AIME_EVAL_*` knobs are dev-only and documented next to the eval suites;
 * the example lists the `AIME_EVAL` switch that gates them.
 */
const INTERNAL = new Set([
  'NODE_ENV',
  'NEXT_RUNTIME',
  'CI',
  'HOME',
  'PATH',
  'SHELL',
  'COMSPEC',
  'npm_package_version',
]);
const INTERNAL_PREFIXES = ['AIME_EVAL_'];

function isInternal(name: string): boolean {
  return INTERNAL.has(name) || INTERNAL_PREFIXES.some((p) => name.startsWith(p));
}

function tracked(...pathspecs: string[]): string[] {
  return execFileSync('git', ['ls-files', ...pathspecs], {
    cwd: webRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
    .filter((f) => existsSync(resolve(webRoot, f))); // tracked but deleted in the working tree
}

const isTestFile = (f: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

/** `process.env.NAME` and `process.env['NAME']` — the two forms this codebase uses. */
const ENV_READ = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g;

function envReadsIn(source: string): string[] {
  return [...source.matchAll(ENV_READ)].map((m) => m[1] ?? m[2]);
}

/** Names in the example, whether active (`X=`) or commented out (`# X=`). */
function documentedIn(example: string): Set<string> {
  const names = new Set<string>();
  for (const line of example.split('\n')) {
    const m = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

describe('env-example scanner', () => {
  it('finds both access forms and ignores lookalikes', () => {
    expect(envReadsIn(`a = process.env.FOO_BAR; b = process.env['BAZ']; c = process.env["QUX"];`))
      .toEqual(['FOO_BAR', 'BAZ', 'QUX']);
    expect(envReadsIn('const { env } = process; env.NOPE; process.envx.NOPE')).toEqual([]);
  });

  it('reads commented and uncommented assignments, not prose', () => {
    const names = documentedIn('# Heading\n# FOO=1\nBAR=\n  #  BAZ=x # note\n# not A=thing\n');
    expect([...names].sort()).toEqual(['BAR', 'BAZ', 'FOO']);
  });
});

describe('web/.env.example', () => {
  it('exists and is not gitignored (a fresh clone must be able to copy it)', () => {
    expect(existsSync(EXAMPLE)).toBe(true);
    // `check-ignore` exits 0 when the path IS ignored. Tracked files never are.
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', '.env.example'], { cwd: webRoot });
    } catch {
      ignored = false;
    }
    expect(ignored, 'web/.gitignore hides .env.example — keep the !.env.example exception').toBe(false);
  });

  const documented = documentedIn(readFileSync(EXAMPLE, 'utf8'));

  it('documents every environment variable web/src reads', () => {
    const missing = new Map<string, string>();
    for (const file of tracked('src').filter((f) => !isTestFile(f))) {
      for (const name of envReadsIn(readFileSync(resolve(webRoot, file), 'utf8'))) {
        if (!documented.has(name) && !isInternal(name) && !missing.has(name)) missing.set(name, file);
      }
    }
    expect(
      Object.fromEntries(missing),
      'add these to web/.env.example (or to INTERNAL here, if no user should ever set them)',
    ).toEqual({});
  });

  it('lists nothing the code no longer reads', () => {
    const corpus = tracked('src', '*.js', 'scripts', 'mcp-servers')
      .filter((f) => !isTestFile(f))
      .map((f) => readFileSync(resolve(webRoot, f), 'utf8'))
      .join('\n');
    const stale = [...documented].filter((name) => !new RegExp(`\\b${name}\\b`).test(corpus));
    expect(stale, 'remove these from web/.env.example — nothing reads them').toEqual([]);
  });
});
