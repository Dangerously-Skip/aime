import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * A streaming `multipart/form-data` reader for exactly one file plus small text
 * fields — the shape `/api/upload` receives.
 *
 * `req.formData()` buffers the entire body in memory, and the route then made
 * two more full copies (`arrayBuffer()` and `Buffer.from`), so a 200 MB video
 * cost ~600 MB of heap. Here the file part goes to disk chunk by chunk as it
 * arrives, each write awaited before the next read (natural backpressure), and
 * the size cap is enforced on the bytes actually received — not on a
 * Content-Length the client chose.
 */

export class UploadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Upload exceeds the ${Math.round(limit / (1024 * 1024))} MB limit`);
    this.name = 'UploadTooLargeError';
  }
}

export class MalformedUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedUploadError';
  }
}

export interface ParsedUpload {
  fields: Record<string, string>;
  file?: { tmpPath: string; filename: string; size: number };
}

export interface ParseOptions {
  /** Directory for the in-progress file; must be on the destination volume. */
  tmpDir: string;
  maxFileBytes: number;
  /** Name of the file field. */
  fileField?: string;
}

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 64 * 1024;
const CRLF = Buffer.from('\r\n');
const HEADER_END = Buffer.from('\r\n\r\n');

/** `boundary` from a Content-Type header, or null. */
export function boundaryFrom(contentType: string | null): string | null {
  if (!contentType || !/^multipart\/form-data/i.test(contentType)) return null;
  const m = /;\s*boundary=(?:"([^"]{1,70})"|([^;\s]{1,70}))/i.exec(contentType);
  return m ? (m[1] ?? m[2]) : null;
}

function dispositionParam(header: string, key: string): string | undefined {
  const m = new RegExp(`;\\s*${key}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(header) ??
    new RegExp(`;\\s*${key}=([^;\\s]+)`, 'i').exec(header);
  return m ? m[1].replace(/\\(.)/g, '$1') : undefined;
}

type Sink =
  | { kind: 'file'; handle: fs.FileHandle; size: number; filename: string }
  | { kind: 'field'; name: string; chunks: Buffer[]; size: number }
  | { kind: 'skip' };

export async function parseMultipartUpload(
  body: AsyncIterable<Uint8Array>,
  boundary: string,
  opts: ParseOptions,
): Promise<ParsedUpload> {
  const fileField = opts.fileField ?? 'file';
  const dashBoundary = Buffer.from(`--${boundary}`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);

  const fields: Record<string, string> = {};
  let file: ParsedUpload['file'];
  let tmpPath: string | null = null;
  let sink: Sink | null = null;
  let buf: Buffer = Buffer.alloc(0);
  type State = 'preamble' | 'after-boundary' | 'headers' | 'body' | 'done';
  let state = 'preamble' as State;

  const emit = async (bytes: Buffer) => {
    if (!sink || bytes.length === 0) return;
    if (sink.kind === 'file') {
      sink.size += bytes.length;
      if (sink.size > opts.maxFileBytes) throw new UploadTooLargeError(opts.maxFileBytes);
      await sink.handle.write(bytes);
    } else if (sink.kind === 'field') {
      sink.size += bytes.length;
      if (sink.size > MAX_FIELD_BYTES) throw new MalformedUploadError(`Field ${sink.name} is too large`);
      sink.chunks.push(Buffer.from(bytes));
    }
  };

  const finishPart = async () => {
    if (!sink) return;
    if (sink.kind === 'file') {
      await sink.handle.close();
      file = { tmpPath: tmpPath!, filename: sink.filename, size: sink.size };
    } else if (sink.kind === 'field') {
      fields[sink.name] = Buffer.concat(sink.chunks).toString('utf8');
    }
    sink = null;
  };

  const startPart = async (rawHeaders: string) => {
    const disposition = rawHeaders
      .split('\r\n')
      .find((l) => /^content-disposition:/i.test(l));
    if (!disposition) throw new MalformedUploadError('Part without Content-Disposition');
    const name = dispositionParam(disposition, 'name') ?? '';
    const filename = dispositionParam(disposition, 'filename');
    if (filename !== undefined && name === fileField) {
      if (file || tmpPath) throw new MalformedUploadError('More than one file in upload');
      await fs.mkdir(opts.tmpDir, { recursive: true });
      tmpPath = path.join(opts.tmpDir, `.upload-${process.pid}-${randomBytes(8).toString('hex')}.part`);
      const handle = await fs.open(tmpPath, 'wx', 0o600);
      sink = { kind: 'file', handle, size: 0, filename };
    } else if (filename === undefined && name) {
      sink = { kind: 'field', name, chunks: [], size: 0 };
    } else {
      sink = { kind: 'skip' };
    }
  };

  const step = async (): Promise<boolean> => {
    switch (state) {
      case 'preamble': {
        const i = buf.indexOf(dashBoundary);
        if (i === -1) {
          buf = buf.subarray(Math.max(0, buf.length - (dashBoundary.length - 1)));
          return false;
        }
        buf = buf.subarray(i + dashBoundary.length);
        state = 'after-boundary';
        return true;
      }
      case 'after-boundary': {
        if (buf.length < 2) return false;
        if (buf[0] === 0x2d && buf[1] === 0x2d) {
          state = 'done';
          return false;
        }
        if (buf[0] === CRLF[0] && buf[1] === CRLF[1]) {
          buf = buf.subarray(2);
          state = 'headers';
          return true;
        }
        throw new MalformedUploadError('Bad multipart boundary');
      }
      case 'headers': {
        const i = buf.indexOf(HEADER_END);
        if (i === -1) {
          if (buf.length > MAX_HEADER_BYTES) throw new MalformedUploadError('Part headers too large');
          return false;
        }
        await startPart(buf.subarray(0, i).toString('utf8'));
        buf = buf.subarray(i + HEADER_END.length);
        state = 'body';
        return true;
      }
      case 'body': {
        const i = buf.indexOf(delimiter);
        if (i === -1) {
          // Hold back enough bytes that a delimiter split across chunks is still found.
          const keep = delimiter.length - 1;
          if (buf.length > keep) {
            await emit(buf.subarray(0, buf.length - keep));
            buf = buf.subarray(buf.length - keep);
          }
          return false;
        }
        await emit(buf.subarray(0, i));
        await finishPart();
        buf = buf.subarray(i + delimiter.length);
        state = 'after-boundary';
        return true;
      }
      default:
        return false;
    }
  };

  try {
    for await (const chunk of body) {
      // A view, not a copy; every write of it is awaited before the next read.
      const view = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      buf = buf.length ? Buffer.concat([buf, view]) : view;
      while (await step()) {
        // keep consuming what is buffered
      }
      if (state === 'done') break;
    }
    if (state !== 'done') throw new MalformedUploadError('Upload ended before the closing boundary');
    return { fields, file };
  } catch (err) {
    const open = sink as Sink | null;
    if (open?.kind === 'file') await open.handle.close().catch(() => {});
    if (tmpPath) await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}
