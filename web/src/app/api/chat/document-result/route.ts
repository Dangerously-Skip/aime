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

  // `path` is deliberately NOT read off the body, and neither is `unclaimed`.
  //
  // This route authenticates nothing and binds nothing to the requester, so
  // everything it accepts is a claim by whoever POSTed. The rendezvous already
  // knows where the PDF was asked to go, so a caller-supplied path is not
  // information — it is only a way to make the model report a file at a path of
  // the caller's choosing. `unclaimed` is the bridge's own word for "nobody
  // answered at all", which the tool turns into "PDF rendering needs the desktop
  // app"; a caller that DID answer must not be able to claim it did not.
  //
  // The remaining claim — `ok` — is checked against the filesystem by the
  // DocumentCreate tool before it tells the model a PDF exists.
  const { toolUseId, ok, bytes, error } = body as {
    toolUseId?: string;
    ok?: boolean;
    bytes?: number;
    error?: string;
  };

  if (!toolUseId || typeof ok !== 'boolean') {
    return Response.json({ error: 'toolUseId and ok are required' }, { status: 400 });
  }

  const resolved = resolveDocumentPrint(toolUseId, {
    ok,
    ...(typeof bytes === 'number' ? { bytes } : {}),
    // Truncated: this string reaches the model's tool result.
    ...(typeof error === 'string' && error ? { error: error.slice(0, 300) } : {}),
  });

  if (!resolved) {
    return Response.json({ error: 'No pending document print for this toolUseId' }, { status: 404 });
  }

  return Response.json({ ok: true });
}
