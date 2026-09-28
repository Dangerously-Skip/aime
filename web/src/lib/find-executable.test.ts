import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, chmod, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findExecutable } from './find-executable';

/**
 * Real filesystem: a temp dir on PATH with one executable, one non-executable
 * file and one directory. Hostile names must resolve to nothing AND run nothing
 * — the sentinel file is what a shell would have created.
 */
let dir: string;
let sentinel: string;
const posix = process.platform !== 'win32';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-find-exe-'));
  sentinel = join(dir, 'pwned');
  await writeFile(join(dir, 'tool'), '#!/bin/sh\n', 'utf8');
  await chmod(join(dir, 'tool'), 0o755);
  await writeFile(join(dir, 'plain'), 'x', 'utf8');
  await chmod(join(dir, 'plain'), 0o644);
  await mkdir(join(dir, 'adir'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.runIf(posix)('findExecutable', () => {
  it('finds an executable file on PATH', async () => {
    expect(await findExecutable('tool', { PATH: `/nonexistent:${dir}` })).toBe(join(dir, 'tool'));
  });

  it('ignores non-executable files and directories', async () => {
    expect(await findExecutable('plain', { PATH: dir })).toBeNull();
    expect(await findExecutable('adir', { PATH: dir })).toBeNull();
  });

  it('accepts an absolute path to an executable', async () => {
    expect(await findExecutable(join(dir, 'tool'), { PATH: '' })).toBe(join(dir, 'tool'));
  });

  it.each([
    `tool; touch SENTINEL`,
    `tool && touch SENTINEL`,
    `$(touch SENTINEL)`,
    '`touch SENTINEL`',
    `tool | touch SENTINEL`,
    `tool\ntouch SENTINEL`,
  ])('treats %j as a filename, never a command', async (template) => {
    const hostile = template.replace('SENTINEL', sentinel);
    expect(await findExecutable(hostile, { PATH: `${dir}:/usr/bin:/bin` })).toBeNull();
    expect(existsSync(sentinel)).toBe(false);
  });
});
