import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  boundaryFrom,
  parseMultipartUpload,
  UploadTooLargeError,
  MalformedUploadError,
} from './multipart';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'aime-multipart-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const B = '----aimeBoundary7MA4YWxk';

function multipart(parts: Array<{ name: string; filename?: string; data: Buffer | string }>): Buffer {
  const out: Buffer[] = [];
  for (const p of parts) {
    const disp = p.filename !== undefined
      ? `form-data; name="${p.name}"; filename="${p.filename}"`
      : `form-data; name="${p.name}"`;
    out.push(Buffer.from(`--${B}\r\nContent-Disposition: ${disp}\r\n`));
    if (p.filename !== undefined) out.push(Buffer.from('Content-Type: application/octet-stream\r\n'));
    out.push(Buffer.from('\r\n'), Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data), Buffer.from('\r\n'));
  }
  out.push(Buffer.from(`--${B}--\r\n`));
  return Buffer.concat(out);
}

/** Split into chunks at the given cut points — the parser must not care where. */
async function* chunked(buf: Buffer, cuts: number[]): AsyncIterable<Uint8Array> {
  const points = [...new Set(cuts.map((c) => c % (buf.length + 1)))].sort((a, b) => a - b);
  let prev = 0;
  for (const p of [...points, buf.length]) {
    if (p > prev) yield new Uint8Array(buf.subarray(prev, p));
    prev = p;
  }
}

const tmpFiles = async () => (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.part'));

describe('boundaryFrom', () => {
  it('reads quoted and bare boundaries, and rejects other content types', () => {
    expect(boundaryFrom(`multipart/form-data; boundary=${B}`)).toBe(B);
    expect(boundaryFrom(`multipart/form-data; boundary="${B}"`)).toBe(B);
    expect(boundaryFrom('application/json')).toBeNull();
    expect(boundaryFrom(null)).toBeNull();
  });
});

describe('parseMultipartUpload', () => {
  it('streams the file to disk byte-exact and collects fields, however it is chunked (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 3000 }),
        fc.array(fc.nat(), { maxLength: 12 }),
        async (bytes, cuts) => {
          // Make near-miss delimiters likely: splice in fragments of the boundary.
          const data = Buffer.concat([Buffer.from(bytes), Buffer.from(`\r\n--${B.slice(0, 10)}`), Buffer.from(bytes)]);
          const body = multipart([
            { name: 'file', filename: 'a b.bin', data },
            { name: 'chatId', data: 'chat-1' },
          ]);
          const r = await parseMultipartUpload(chunked(body, cuts), B, { tmpDir: dir, maxFileBytes: 1 << 20 });
          expect(r.fields).toEqual({ chatId: 'chat-1' });
          expect(r.file!.filename).toBe('a b.bin');
          expect(r.file!.size).toBe(data.length);
          expect(Buffer.compare(await fs.readFile(r.file!.tmpPath), data)).toBe(0);
          await fs.rm(r.file!.tmpPath);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('enforces the cap on bytes received and removes the partial file', async () => {
    const body = multipart([{ name: 'file', filename: 'big', data: Buffer.alloc(5000, 7) }]);
    await expect(
      parseMultipartUpload(chunked(body, [100, 900, 2000]), B, { tmpDir: dir, maxFileBytes: 4096 }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(await tmpFiles()).toEqual([]);
  });

  it('rejects a truncated body and removes the partial file', async () => {
    const body = multipart([{ name: 'file', filename: 'x', data: 'hello world' }]);
    const truncated = body.subarray(0, body.length - 20);
    await expect(
      parseMultipartUpload(chunked(truncated, []), B, { tmpDir: dir, maxFileBytes: 1 << 20 }),
    ).rejects.toBeInstanceOf(MalformedUploadError);
    expect(await tmpFiles()).toEqual([]);
  });

  it('rejects more than one file', async () => {
    const body = multipart([
      { name: 'file', filename: 'a', data: 'a' },
      { name: 'file', filename: 'b', data: 'b' },
    ]);
    await expect(
      parseMultipartUpload(chunked(body, []), B, { tmpDir: dir, maxFileBytes: 1 << 20 }),
    ).rejects.toBeInstanceOf(MalformedUploadError);
    expect(await tmpFiles()).toEqual([]);
  });

  it('returns no file when none was sent', async () => {
    const body = multipart([{ name: 'chatId', data: 'c' }]);
    const r = await parseMultipartUpload(chunked(body, [3]), B, { tmpDir: dir, maxFileBytes: 10 });
    expect(r.file).toBeUndefined();
    expect(r.fields.chatId).toBe('c');
  });
});
