import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  safeUploadName,
  reserveUniquePath,
  writeUniqueFile,
  copyIntoUnique,
  isRealPathWithin,
} from './store';

let dir: string;
beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'aime-upload-store-')));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('safeUploadName', () => {
  it.each([
    ['photo.png', 'photo.png'],
    ['my photo (1).png', 'my_photo__1_.png'],
    ['..', 'file'],
    ['.', 'file'],
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\boot.ini', 'boot.ini'],
    ['.hidden', 'hidden'],
    ['', 'file'],
  ])('%j → %j', (input, expected) => {
    expect(safeUploadName(input)).toBe(expected);
  });

  it('bounds the length and keeps the extension', () => {
    const s = safeUploadName('a'.repeat(500) + '.pdf');
    expect(s.length).toBeLessThanOrEqual(180);
    expect(s.endsWith('.pdf')).toBe(true);
  });
});

describe('unique stored names', () => {
  // REGRESSION: both writers used uploads/<name>, so a second image.png in the
  // same conversation overwrote the first.
  it('two same-named attachments are both kept', async () => {
    const a = await writeUniqueFile(dir, 'image.png', Buffer.from('first'));
    const b = await writeUniqueFile(dir, 'image.png', Buffer.from('second'));
    expect(path.basename(a)).toBe('image.png');
    expect(path.basename(b)).toBe('image-2.png');
    expect(await fs.readFile(a, 'utf-8')).toBe('first');
    expect(await fs.readFile(b, 'utf-8')).toBe('second');
  });

  it('concurrent reservations of one name never collide', async () => {
    const paths = await Promise.all(Array.from({ length: 12 }, () => reserveUniquePath(dir, 'doc.pdf')));
    expect(new Set(paths).size).toBe(12);
  });

  it('suffixes names without an extension', async () => {
    await writeUniqueFile(dir, 'Makefile', Buffer.from('1'));
    expect(path.basename(await writeUniqueFile(dir, 'Makefile', Buffer.from('2')))).toBe('Makefile-2');
  });

  it('copyIntoUnique copies and removes its reservation on failure', async () => {
    const src = path.join(dir, 'src.txt');
    await fs.writeFile(src, 'x');
    const out = path.join(dir, 'out');
    expect(await fs.readFile(await copyIntoUnique(src, out, 'src.txt'), 'utf-8')).toBe('x');
    await expect(copyIntoUnique(path.join(dir, 'missing'), out, 'm.txt')).rejects.toThrow();
    expect(await fs.readdir(out)).toEqual(['src.txt']);
  });
});

describe('isRealPathWithin', () => {
  it('accepts a file under the root and refuses anything that resolves outside it', async () => {
    const root = path.join(dir, 'scratch');
    await fs.mkdir(path.join(root, 'c1', 'uploads'), { recursive: true });
    const inside = path.join(root, 'c1', 'uploads', 'a.pdf');
    await fs.writeFile(inside, 'a');
    const outside = path.join(dir, 'secret');
    await fs.writeFile(outside, 's');
    const link = path.join(root, 'c1', 'uploads', 'link.pdf');
    await fs.symlink(outside, link);

    expect(await isRealPathWithin(root, inside)).toBe(inside);
    expect(await isRealPathWithin(root, outside)).toBeNull();
    expect(await isRealPathWithin(root, link)).toBeNull();
    expect(await isRealPathWithin(root, path.join(root, 'c1', '..', '..', 'secret'))).toBeNull();
    expect(await isRealPathWithin(root, root)).toBeNull();
    expect(await isRealPathWithin(root, undefined)).toBeNull();
  });
});
