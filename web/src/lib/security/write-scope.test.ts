import { describe, it, expect } from 'vitest';
import { writeTargetAllowed, FILE_WRITE_TOOLS } from './write-scope';

/**
 * "Restrict writes to project folder" was prompt-only. Unlike a shell command
 * (see ./destructive-commands, which is why THAT one asks instead of blocking),
 * a write target is decidable, so this one is enforced.
 *
 * The carve-outs are the reason this needed testing rather than just writing:
 * scratch lives at `~/.aime/scratch/<chatId>`, outside every project folder, so
 * the obvious "must be under cwd" check breaks the app on its first turn.
 */

const CWD = '/Users/x/projects/app';
const DATA = '/Users/x/.aime';
const TMP = '/var/folders/tmp';
const deps = { dataDir: DATA, tmpDir: TMP };
const allowed = (t: string) => writeTargetAllowed(t, CWD, 'chat-1', deps);

describe('writeTargetAllowed', () => {
  it('allows writes inside the working directory, at any depth', () => {
    expect(allowed(`${CWD}/README.md`)).toBe(true);
    expect(allowed(`${CWD}/src/lib/deep/thing.ts`)).toBe(true);
  });

  it('resolves a relative path against the working directory', () => {
    // What a tool call passing `src/lib/x.ts` actually means.
    expect(allowed('src/lib/x.ts')).toBe(true);
    expect(allowed('./notes.md')).toBe(true);
  });

  it('refuses the places the setting exists to protect', () => {
    expect(allowed('/Users/x/.ssh/id_rsa')).toBe(false);
    expect(allowed('/Users/x/projects/other-app/src/x.ts')).toBe(false);
    expect(allowed('/etc/hosts')).toBe(false);
    expect(allowed('/Users/x/Documents/taxes.xlsx')).toBe(false);
  });

  it('refuses a climb back out of the working directory', () => {
    expect(allowed(`${CWD}/../other/x.ts`)).toBe(false);
    expect(allowed('../../../etc/passwd')).toBe(false);
    // Including one that ends up back inside a DIFFERENT allowed root by luck —
    // still fine, because the check is on the resolved path, not the string.
    expect(allowed(`${CWD}/../../.aime/scratch/c/x.md`)).toBe(true);
  });

  it('allows the scratch directory — the carve-out the app cannot work without', () => {
    expect(allowed(`${DATA}/scratch/chat-1/notes.md`)).toBe(true);
    // Not just this chat's: the document and skill writers use shared subfolders.
    expect(allowed(`${DATA}/scratch/other-chat/x.md`)).toBe(true);
    expect(allowed(`${DATA}/documents/report.html`)).toBe(true);
  });

  it('allows temp, because staging a file there is ordinary work', () => {
    expect(allowed(`${TMP}/intermediate.json`)).toBe(true);
  });

  it('refuses the base directories themselves — a directory is not a file', () => {
    expect(allowed(CWD)).toBe(false);
    expect(allowed(DATA)).toBe(false);
  });

  it('refuses garbage rather than defaulting open', () => {
    expect(allowed('')).toBe(false);
    expect(writeTargetAllowed('/x', '', 'c', deps)).toBe(false);
  });
});

describe('FILE_WRITE_TOOLS', () => {
  it('covers the tools that take a path and write to it', () => {
    for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(FILE_WRITE_TOOLS.has(t), t).toBe(true);
    }
    // Read is deliberately absent — the setting says reading outside is allowed.
    expect(FILE_WRITE_TOOLS.has('Read')).toBe(false);
    // Bash is not a file tool; it resolves no path and is the command gate's job.
    expect(FILE_WRITE_TOOLS.has('Bash')).toBe(false);
  });
});
