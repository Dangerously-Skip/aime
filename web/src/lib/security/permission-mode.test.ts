import { describe, it, expect, afterAll } from 'vitest';
import fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { evaluatePermissionMode, isChange } from './permission-mode';
import { CODE_PERMISSION_MODES } from '../surfaces/code-permission-mode';

/**
 * The decision table behind Code's permission-mode menu, as properties.
 *
 * The provider test drives each sentence of the menu through the real
 * `canUseTool`; this one throws generated paths and commands at the verdicts,
 * because the claims are universal ("no file edits", "every file edit") and a
 * handful of hand-picked paths cannot show a universal.
 */

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-pm-project-'));
const plansDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-pm-plans-'));
const ctx = { cwd, plansDir };
afterAll(() => {
  for (const d of [cwd, plansDir]) fs.rmSync(d, { recursive: true, force: true });
});

const WRITERS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'mcp__aime__ExcelWrite', 'mcp__aime__ExcelEdit'];

/** Relative and absolute path fragments, including climbs and odd characters. */
const segment = fc.stringMatching(/^[A-Za-z0-9._ -]{1,12}$/);
const relPath = fc.array(fc.oneof(segment, fc.constant('..'), fc.constant('.')), { minLength: 1, maxLength: 6 }).map((p) => p.join('/'));
/** The oracle: does `target`, resolved from the project, land strictly inside `base`? */
function within(base: string, target: string): boolean {
  const rel = path.relative(base, path.resolve(cwd, target));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

const anyPath = fc.oneof(
  relPath,
  relPath.map((p) => path.join(cwd, p)),
  relPath.map((p) => path.join(plansDir, p)),
  relPath.map((p) => `/${p}`),
);

describe('plan mode', () => {
  it('never lets a file tool write anywhere but the plans directory', () => {
    fc.assert(
      fc.property(fc.constantFrom(...WRITERS), anyPath, (tool, target) => {
        const v = evaluatePermissionMode('plan', tool, { file_path: target, content: 'x' }, ctx);
        return v.kind === (within(plansDir, target) ? 'allow' : 'deny');
      }),
      { numRuns: 500 },
    );
  });

  it('never asks — a question would turn plan mode into something else', () => {
    fc.assert(
      fc.property(fc.constantFrom(...WRITERS, 'Bash', 'Read', 'EnterWorktree'), anyPath, fc.string(), (tool, target, command) => {
        const v = evaluatePermissionMode('plan', tool, { file_path: target, command }, ctx);
        return v.kind !== 'ask';
      }),
    );
  });

  it('refuses a shell command it cannot prove read-only', () => {
    for (const command of ['rm -rf x', 'npm install', 'cat a > b', 'git commit -m x', 'python -c "open(1)"', 'tee out.txt']) {
      expect(evaluatePermissionMode('plan', 'Bash', { command }, ctx).kind).toBe('deny');
    }
    expect(evaluatePermissionMode('plan', 'Bash', { command: 'git diff' }, ctx).kind).toBe('allow');
  });
});

describe('ask mode', () => {
  it('asks about every file-tool write, wherever it points', () => {
    fc.assert(
      fc.property(fc.constantFrom(...WRITERS), anyPath, (tool, target) =>
        evaluatePermissionMode('default', tool, { file_path: target, content: 'x' }, ctx).kind === 'ask',
      ),
      { numRuns: 300 },
    );
  });

  it('asks about any shell command the classifier cannot prove read-only', () => {
    fc.assert(
      fc.property(fc.string(), (command) => {
        const v = evaluatePermissionMode('default', 'Bash', { command }, ctx);
        return v.kind === (isChange('Bash', { command }) ? 'ask' : 'allow');
      }),
      { numRuns: 500 },
    );
  });

  it('keys a declined command on its normalised text', () => {
    const a = evaluatePermissionMode('default', 'Bash', { command: 'npm  install "x"' }, ctx);
    const b = evaluatePermissionMode('default', 'Bash', { command: 'npm install x' }, ctx);
    expect(a.kind === 'ask' && b.kind === 'ask' && a.key === b.key).toBe(true);
  });

  it('does not treat a lookalike from another server as exempt', () => {
    // `TodoWrite` is exempt; a remote tool that borrows its name is not.
    expect(isChange('TodoWrite', {})).toBe(false);
    expect(isChange('mcp__evil__TodoWrite', {})).toBe(true);
  });
});

describe('auto accept edits', () => {
  it('asks exactly when a file tool writes outside the project folder', () => {
    fc.assert(
      fc.property(fc.constantFrom(...WRITERS), anyPath, (tool, target) => {
        const v = evaluatePermissionMode('acceptEdits', tool, { file_path: target, content: 'x' }, ctx);
        return v.kind === (within(cwd, target) ? 'allow' : 'ask');
      }),
      { numRuns: 500 },
    );
  });
});

describe('bypass', () => {
  it('adds nothing of its own — the security gates are separate', () => {
    fc.assert(
      fc.property(fc.constantFrom(...WRITERS, 'Bash'), anyPath, fc.string(), (tool, target, command) =>
        evaluatePermissionMode('bypass', tool, { file_path: target, command }, ctx).kind === 'allow',
      ),
    );
  });
});

it('covers every mode the menu can send', () => {
  for (const mode of CODE_PERMISSION_MODES) {
    expect(evaluatePermissionMode(mode, 'Read', { file_path: 'x' }, ctx).kind).toBe('allow');
  }
});
