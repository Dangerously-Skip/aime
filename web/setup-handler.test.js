import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { resolveSetupDir, repairMovedScripts } = require_('./setup-handler.js');

/**
 * The managed Python lived in ~/.quarry while the rest of the app moved to
 * ~/.aime — and the server's own migration renamed ~/.quarry out from under the
 * path main had already handed it, so the next launch found no install and ran
 * the ~300 MB setup again. Real directories in a temp HOME; nothing touches the
 * developer's own.
 */

let home;
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'setup-home-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const isWin = process.platform === 'win32';

function install(dir) {
  const py = isWin ? path.join(dir, 'python', 'python.exe') : path.join(dir, 'python', 'bin', 'python3');
  mkdirSync(path.dirname(py), { recursive: true });
  writeFileSync(py, 'binary');
  writeFileSync(path.join(dir, '.setup-complete'), '{}');
}

describe('resolveSetupDir', () => {
  it('fresh machine: ~/.aime', () => {
    expect(resolveSetupDir(home)).toBe(path.join(home, '.aime'));
    expect(existsSync(path.join(home, '.quarry'))).toBe(false);
  });

  it('only ~/.quarry: renames it to ~/.aime and keeps the install', () => {
    install(path.join(home, '.quarry'));
    expect(resolveSetupDir(home)).toBe(path.join(home, '.aime'));
    expect(existsSync(path.join(home, '.quarry'))).toBe(false);
    expect(existsSync(path.join(home, '.aime', '.setup-complete'))).toBe(true);
  });

  it('both exist, install only in the legacy dir: keeps reading ~/.quarry rather than re-running setup', () => {
    install(path.join(home, '.quarry'));
    mkdirSync(path.join(home, '.aime', 'scratch'), { recursive: true });
    expect(resolveSetupDir(home)).toBe(path.join(home, '.quarry'));
    // and does not disturb either directory
    expect(existsSync(path.join(home, '.aime', 'scratch'))).toBe(true);
  });

  it('both exist, install in ~/.aime: ~/.aime wins', () => {
    install(path.join(home, '.quarry'));
    install(path.join(home, '.aime'));
    expect(resolveSetupDir(home)).toBe(path.join(home, '.aime'));
  });

  it('a sentinel without an interpreter is not an install', () => {
    mkdirSync(path.join(home, '.quarry'), { recursive: true });
    writeFileSync(path.join(home, '.quarry', '.setup-complete'), '{}');
    mkdirSync(path.join(home, '.aime'), { recursive: true });
    expect(resolveSetupDir(home)).toBe(path.join(home, '.aime'));
  });
});

describe.skipIf(isWin)('repairMovedScripts', () => {
  it('rewrites pip script shebangs that point into the old directory, and nothing else', () => {
    const from = path.join(home, '.quarry', 'python');
    const to = path.join(home, '.aime', 'python');
    const bin = path.join(to, 'bin');
    mkdirSync(bin, { recursive: true });
    const body = 'import sys\nfrom pip._internal.cli.main import main\n# mentions /elsewhere/.quarry/python\n';
    writeFileSync(path.join(bin, 'pip3'), `#!${from}/bin/python3\n${body}`);
    chmodSync(path.join(bin, 'pip3'), 0o755);
    // pip's long-path trampoline form
    writeFileSync(path.join(bin, 'playwright'), `#!/bin/sh\n'''exec' "${from}/bin/python3" "$0" "$@"\n' '''\n${body}`);
    writeFileSync(path.join(bin, 'other'), '#!/usr/bin/env python3\nprint(1)\n');
    writeFileSync(path.join(bin, 'python3'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 1, 2]));

    expect(repairMovedScripts(bin, from, to)).toBe(2);
    expect(readFileSync(path.join(bin, 'pip3'), 'utf-8')).toBe(`#!${to}/bin/python3\n${body}`);
    expect(readFileSync(path.join(bin, 'playwright'), 'utf-8')).toContain(`"${to}/bin/python3"`);
    expect(readFileSync(path.join(bin, 'other'), 'utf-8')).toBe('#!/usr/bin/env python3\nprint(1)\n');
    // the execute bit survives the rewrite
    expect(statSync(path.join(bin, 'pip3')).mode & 0o111).not.toBe(0);
    // idempotent
    expect(repairMovedScripts(bin, from, to)).toBe(0);
  });

  it('runs as part of resolving a migrated install', () => {
    const legacy = path.join(home, '.quarry');
    install(legacy);
    writeFileSync(path.join(legacy, 'python', 'bin', 'pip'), `#!${legacy}/python/bin/python3\nx\n`);
    resolveSetupDir(home);
    expect(readFileSync(path.join(home, '.aime', 'python', 'bin', 'pip'), 'utf-8')).toBe(
      `#!${path.join(home, '.aime')}/python/bin/python3\nx\n`,
    );
  });

  it('a missing bin dir is a no-op', () => {
    expect(repairMovedScripts(path.join(home, 'nope'), 'a', 'b')).toBe(0);
  });
});
