import { NextRequest } from 'next/server';
import { resolveBrowserToolResult } from '@/lib/pending-browser-tools';

export const runtime = 'nodejs';

/**
 * POST /api/chat/browser-tool-result
 *
 * Receives the result of a browser tool executed in the client webview
 * and unblocks the waiting canUseTool promise in the ClaudeProvider.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { toolUseId, output, isError } = body as {
    toolUseId?: string;
    output?: string;
    isError?: boolean;
  };

  if (!toolUseId || typeof output !== 'string') {
    return Response.json(
      { error: 'toolUseId and output are required' },
      { status: 400 },
    );
  }

  const resolved = resolveBrowserToolResult(toolUseId, output, isError ?? false);

  if (!resolved) {
    return Response.json(
      { error: 'No pending browser tool found for this toolUseId' },
      { status: 404 },
    );
  }

  return Response.json({ ok: true });
}
