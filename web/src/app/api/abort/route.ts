import { NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';

export const runtime = 'nodejs';

/**
 * Abort endpoint to stop active queries.
 * POST /api/abort
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    chatId,
    surfaceId,
    provider: providerName = 'claude',
  } = body as {
    chatId?: string;
    surfaceId?: string;
    provider?: string;
  };

  if (!chatId) {
    return Response.json({ error: 'chatId is required' }, { status: 400 });
  }

  console.log('[ABORT] Request to abort chatId:', chatId, 'provider:', providerName, 'surface:', surfaceId || '(none)');

  try {
    const provider = getProvider(providerName as string);
    // Pass surfaceId if the provider supports it
    const aborted = surfaceId
      ? provider.abort(chatId, surfaceId)
      : provider.abort(chatId);

    if (aborted) {
      console.log('[ABORT] Successfully aborted chatId:', chatId);
      return Response.json({ success: true, message: 'Query aborted' });
    } else {
      console.log('[ABORT] No active query found for chatId:', chatId);
      return Response.json({ success: false, message: 'No active query to abort' });
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[ABORT] Error:', errMsg);
    return Response.json({ error: errMsg }, { status: 500 });
  }
}
