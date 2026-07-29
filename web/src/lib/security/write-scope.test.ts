import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  writeTargetAllowed,
  writeTargetOf,
  isFileWriteTool,
  canonicalise,
  resetWriteScopeCache,
  FILE_WRITE_TOOLS,
} from './write-scope';

/**
 * "Restrict writes to project folder" was prompt-only. Unlike a shell command
 * (see ./destructive-commands, which is why THAT one asks instead of blocking),
 * a write target is decidable, so this one is enforced.
 *
 * These run against a REAL temp directory rather than string fixtures, because
 * the two bugs that got through were both about the difference: `os.tmpdir()`
 * not matching its own realpath on macOS, and symlinks being resolved by the
 * filesystem but not by the check.
 */

let root: string;
let cwd: string;
let scratch: string;
let tmp: string;
/** Bases as the caller supplies them, so the module cache is bypassed. */
let deps: { dataScratch: string; tmpDir: string };

beforeEach(() => {
  resetWriteScopeCache();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-scope-'));
  cwd = path.join(root, 'projects', 'app');
  scratch = path.join(root, 'data', 'scratch');
  tmp = path.join(root, 'tmp');
  for (const d of [cwd, scratch, tmp, path.join(root, 'other')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  deps = { dataScratch: canonicalise(scratch), tmpDir: canonicalise(tmp) };
});

afterEach(() => {
  resetWriteScopeCache();
  fs.rmSync(root, { recursive: true, force: true });
});

const allowed = (t: string) => writeTargetAllowed(t, cwd, deps);

describe('writeTargetAllowed', () => {
  it('allows writes inside the working directory, at any depth', () => {
    expect(allowed(path.join(cwd, 'README.md'))).toBe(true);
    expect(allowed(path.join(cwd, 'src/lib/deep/thing.ts'))).toBe(true);
  });

  it('resolves a relative path against the working directory', () => {
    expect(allowed('src/lib/x.ts')).toBe(true);
    expect(allowed('./notes.md')).toBe(true);
  });

  it('refuses the places the setting exists to protect', () => {
    expect(allowed(path.join(root, 'other', 'x.ts'))).toBe(false);
    expect(allowed('/etc/hosts')).toBe(false);
    expect(allowed(path.join(os.homedir(), '.ssh', 'id_rsa'))).toBe(false);
  });

  it('refuses a climb back out of the working directory', () => {
    expect(allowed(path.join(cwd, '..', 'other', 'x.ts'))).toBe(false);
    expect(allowed('../../../etc/passwd')).toBe(false);
  });

  it('allows the scratch subtree — the carve-out the app cannot work without', () => {
    expect(allowed(path.join(scratch, 'chat-1', 'notes.md'))).toBe(true);
  });

  /**
   * The escalation that shipped: the carve-out was the WHOLE data dir, which
   * holds credentials.enc and is handed to the SDK as CLAUDE_CONFIG_DIR — so a
   * permitted write could install a hook command that runs outside canUseTool.
   */
  it('refuses the rest of the data directory, not just outside it', () => {
    const dataDir = path.dirname(scratch);
    expect(allowed(path.join(dataDir, 'settings.json'))).toBe(false);
    expect(allowed(path.join(dataDir, 'credentials.enc'))).toBe(false);
    expect(allowed(path.join(dataDir, 'runs', 'log.jsonl'))).toBe(false);
  });

  it('allows temp, and allows its realpath form', () => {
    expect(allowed(path.join(tmp, 'intermediate.json'))).toBe(true);
    // On macOS os.tmpdir() is /var/... while anything resolved is /private/var/...
    // — two strings with no common prefix. The carve-out silently did not work.
    expect(allowed(path.join(fs.realpathSync(tmp), 'staged.csv'))).toBe(true);
  });

  it('allows the real system temp dir under either spelling', () => {
    resetWriteScopeCache();
    const viaEnv = writeTargetAllowed(path.join(os.tmpdir(), 'a.txt'), cwd);
    const viaReal = writeTargetAllowed(path.join(fs.realpathSync(os.tmpdir()), 'a.txt'), cwd);
    expect(viaEnv).toBe(true);
    expect(viaReal).toBe(true);
  });

  /**
   * Pure string containment let `ln -s ~/.ssh ./s` + a write to `./s/x` land
   * outside the tree — and `ln` matches no destructive rule, so the agent could
   * build the escape itself.
   */
  it('refuses a write through a symlink that points outside', () => {
    const secret = path.join(root, 'other', 'secrets');
    fs.mkdirSync(secret, { recursive: true });
    fs.symlinkSync(secret, path.join(cwd, 'link'));
    expect(allowed(path.join(cwd, 'link', 'authorized_keys'))).toBe(false);
  });

  it('still allows a symlink that stays inside the tree', () => {
    const inside = path.join(cwd, 'real');
    fs.mkdirSync(inside, { recursive: true });
    fs.symlinkSync(inside, path.join(cwd, 'alias'));
    expect(allowed(path.join(cwd, 'alias', 'x.ts'))).toBe(true);
  });

  it('allows a cwd that is itself reached through a symlink', () => {
    const linkedCwd = path.join(root, 'linked-app');
    fs.symlinkSync(cwd, linkedCwd);
    expect(writeTargetAllowed(path.join(linkedCwd, 'a.ts'), linkedCwd, deps)).toBe(true);
    // ...and the same file named through the real path.
    expect(writeTargetAllowed(path.join(cwd, 'a.ts'), linkedCwd, deps)).toBe(true);
  });

  it('refuses the base directory itself — a directory is not a file in it', () => {
    expect(allowed(cwd)).toBe(false);
  });

  it('fails closed on empty input', () => {
    expect(allowed('')).toBe(false);
    expect(writeTargetAllowed('/x', '', deps)).toBe(false);
  });
});

describe('canonicalise', () => {
  it('resolves a path that does not exist yet via its deepest real ancestor', () => {
    const target = path.join(cwd, 'not', 'there', 'yet.ts');
    expect(canonicalise(target)).toBe(path.join(fs.realpathSync(cwd), 'not/there/yet.ts'));
  });

  it('returns a resolved path when nothing on it exists', () => {
    expect(canonicalise('/definitely/not/here/x')).toBe('/definitely/not/here/x');
  });
});

describe('tool coverage', () => {
  it('covers the tools that take a path and write to it', () => {
    for (const t of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
      expect(isFileWriteTool(t), t).toBe(true);
    }
  });

  /** These are mounted on the in-process `aime` server and arrive prefixed. */
  it('covers the MCP writers under BOTH the bare and prefixed names', () => {
    for (const t of ['ExcelWrite', 'ExcelEdit', 'DocumentCreate', 'SkillCreate']) {
      expect(isFileWriteTool(t), t).toBe(true);
      expect(isFileWriteTool(`mcp__aime__${t}`), `mcp__aime__${t}`).toBe(true);
    }
  });

  it('leaves readers and the shell alone', () => {
    // The setting says reading outside is still allowed.
    expect(isFileWriteTool('Read')).toBe(false);
    expect(isFileWriteTool('Glob')).toBe(false);
    // Bash resolves no path here; that is the command gate's job.
    expect(isFileWriteTool('Bash')).toBe(false);
    expect(FILE_WRITE_TOOLS.has('Read')).toBe(false);
  });
});

describe('writeTargetOf', () => {
  it('finds the destination whichever key the tool used', () => {
    expect(writeTargetOf({ file_path: '/a' })).toBe('/a');
    expect(writeTargetOf({ notebook_path: '/b' })).toBe('/b');
    expect(writeTargetOf({ path: '/c' })).toBe('/c');
    expect(writeTargetOf({ outputPath: '/d' })).toBe('/d');
  });

  it('returns null when there is no path to check', () => {
    expect(writeTargetOf({ command: 'ls' })).toBeNull();
    expect(writeTargetOf({ file_path: 42 })).toBeNull();
    expect(writeTargetOf({ file_path: '' })).toBeNull();
  });
});
