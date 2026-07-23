/**
 * Multipart file upload endpoint.
 * Streams large files to the per-chat scratch dir (<dataDir>/scratch/{chatId}/uploads/{name}).
 * Returns { path, size, name }.
 */
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const chatId = formData.get('chatId') as string | null;

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }
    if (!chatId) {
      return Response.json({ error: 'chatId is required' }, { status: 400 });
    }

    const { join } = await import('path');
    const { mkdirSync, writeFileSync } = await import('fs');
    const { getScratchDir } = await import('@/lib/app-paths');

    const uploadDir = join(getScratchDir(chatId), 'uploads');
    mkdirSync(uploadDir, { recursive: true });

    // Sanitize filename
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = join(uploadDir, safeName);

    // Write file to disk
    const arrayBuffer = await file.arrayBuffer();
    writeFileSync(filePath, Buffer.from(arrayBuffer));

    return Response.json({
      path: filePath,
      size: file.size,
      name: file.name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Upload] Error:', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
