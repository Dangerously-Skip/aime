/**
 * Multipart file upload endpoint.
 * Streams the file to the per-chat scratch dir
 * (<dataDir>/scratch/{chatId}/uploads/{unique name}) without holding it in
 * memory, capped at MAX_UPLOAD_BYTES. Returns { path, size, name } — `name` is
 * the display name as sent; `path` may carry a `-2` style suffix when the
 * conversation already has a file of that name.
 */
import { NextRequest } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getScratchDir, getScratchRoot, isSafeChatId } from '@/lib/app-paths';
import {
  boundaryFrom,
  parseMultipartUpload,
  MalformedUploadError,
  UploadTooLargeError,
} from '@/lib/uploads/multipart';
import { MAX_UPLOAD_BYTES, moveIntoUnique } from '@/lib/uploads/store';

export const runtime = 'nodejs';

/** Room for the multipart envelope and the chatId field around the file. */
const ENVELOPE_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const boundary = boundaryFrom(req.headers.get('content-type'));
  if (!boundary || !req.body) {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
  // Refuse early when the client says up front it is too big; the parser
  // enforces the same cap on the bytes actually received either way.
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + ENVELOPE_BYTES) {
    return tooLarge();
  }

  let tmpPath: string | undefined;
  try {
    // Staged under the scratch root so the final move is a same-volume rename.
    const parsed = await parseMultipartUpload(
      req.body as unknown as AsyncIterable<Uint8Array>,
      boundary,
      { tmpDir: path.join(getScratchRoot(), '.incoming'), maxFileBytes: MAX_UPLOAD_BYTES },
    );
    tmpPath = parsed.file?.tmpPath;

    if (!parsed.file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }
    const chatId = parsed.fields.chatId;
    if (!chatId) {
      return Response.json({ error: 'chatId is required' }, { status: 400 });
    }
    // The chatId becomes a directory name; getScratchDir would throw on `../..`.
    if (!isSafeChatId(chatId)) {
      return Response.json({ error: 'Invalid chatId' }, { status: 400 });
    }

    const uploadDir = path.join(getScratchDir(chatId), 'uploads');
    const filePath = await moveIntoUnique(parsed.file.tmpPath, uploadDir, parsed.file.filename);
    tmpPath = undefined;

    return Response.json({
      path: filePath,
      size: parsed.file.size,
      name: parsed.file.filename,
    });
  } catch (err) {
    if (err instanceof UploadTooLargeError) return tooLarge();
    if (err instanceof MalformedUploadError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error('[Upload] Error:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Upload failed' }, { status: 500 });
  } finally {
    if (tmpPath) await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

function tooLarge(): Response {
  return Response.json(
    { error: `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB upload limit` },
    { status: 413 },
  );
}
