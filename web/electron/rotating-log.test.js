import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { createRotatingLog } = require_('./rotating-log.js');

/**
 * aime.log rotated only at launch; an app left open for days, with the whole
 * Next server's output piped through it, grew without bound. Real files in a
 * temp dir — the rename is the behaviour under test.
 */

let dir;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'rotating-log-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createRotatingLog', () => {
  it('rotates while running, once the file would pass maxBytes', async () => {
    const file = path.join(dir, 'logs', 'aime.log');
    const log = createRotatingLog({ file, maxBytes: 100 });
    for (let i = 0; i < 4; i++) log.write(`line ${i} ${'x'.repeat(30)}\n`);
    await log.close();

    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(file).size).toBeLessThanOrEqual(100);
    const all = readFileSync(`${file}.1`, 'utf-8') + readFileSync(file, 'utf-8');
    // Nothing lost across the rotation (only one generation is kept, and four
    // ~40-byte lines fit in two 100-byte files).
    for (let i = 0; i < 4; i++) expect(all).toContain(`line ${i} `);
  });

  it('keeps at most one rotated generation — bounded on disk', async () => {
    const file = path.join(dir, 'aime.log');
    const log = createRotatingLog({ file, maxBytes: 50 });
    for (let i = 0; i < 40; i++) log.write(`${String(i).padStart(3, '0')} ${'y'.repeat(20)}\n`);
    await log.close();
    expect(existsSync(`${file}.2`)).toBe(false);
    expect(statSync(file).size + statSync(`${file}.1`).size).toBeLessThanOrEqual(2 * 50);
    // The newest line is in the live file.
    expect(readFileSync(file, 'utf-8')).toContain('039 ');
  });

  it('rotates a file left oversized by a previous run before writing', async () => {
    const file = path.join(dir, 'aime.log');
    writeFileSync(file, 'z'.repeat(500));
    const log = createRotatingLog({ file, maxBytes: 100 });
    log.write('fresh\n');
    await log.close();
    expect(readFileSync(file, 'utf-8')).toBe('fresh\n');
    expect(readFileSync(`${file}.1`, 'utf-8')).toBe('z'.repeat(500));
  });

  it('appends to a small existing file and counts its size', async () => {
    const file = path.join(dir, 'aime.log');
    writeFileSync(file, 'a'.repeat(90));
    const log = createRotatingLog({ file, maxBytes: 100 });
    log.write('b'.repeat(20));
    await log.close();
    expect(readFileSync(file, 'utf-8')).toBe('b'.repeat(20));
    expect(readFileSync(`${file}.1`, 'utf-8')).toBe('a'.repeat(90));
  });

  it('a single line larger than maxBytes is still written, not dropped', async () => {
    const file = path.join(dir, 'aime.log');
    const log = createRotatingLog({ file, maxBytes: 10 });
    log.write('0123456789ABCDEF\n');
    await log.close();
    expect(readFileSync(file, 'utf-8')).toBe('0123456789ABCDEF\n');
  });
});
