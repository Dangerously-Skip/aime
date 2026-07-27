import { NextRequest } from 'next/server';
import { resolveDocumentPrint } from '@/lib/pending-documents';

export const runtime = 'nodejs';

/**
 * POST /api/chat/document-result
 *
 * Reports the outcome of a client-side PDF print (P4.2b) and unblocks the waiting
 * DocumentCreate tool call, so the agent's turn resumes on the original stream.
 *
 * Body: { toolUseId, ok, path?, bytes?, error? }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { toolUseId, ok, path, bytes, error } = body as {
    toolUseId?: string;
    ok?: boolean;
    path?: string;
    bytes?: number;
    error?: string;
  };

  if (!toolUseId || typeof ok !== 'boolean') {
    return Response.json({ error: 'toolUseId and ok are required' }, { status: 400 });
  }

  const resolved = resolveDocumentPrint(toolUseId, {
    ok,
    ...(typeof path === 'string' ? { path } : {}),
    ...(typeof bytes === 'number' ? { bytes } : {}),
    // Truncated: this string reaches the model's tool result.
    ...(typeof error === 'string' && error ? { error: error.slice(0, 300) } : {}),
  });

  if (!resolved) {
    return Response.json({ error: 'No pending document print for this toolUseId' }, { status: 404 });
  }

  return Response.json({ ok: true });
}
