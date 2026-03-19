import { NextRequest } from 'next/server';
import { getProvider } from '@/lib/providers';

export const runtime = 'nodejs';

/**
 * POST /api/session/reset
 * Clears the provider session for a given chatId.
 * Used by session reset policies (idle, daily).
 */
export async function POST(req: NextRequest) {
  try {
    const { chatId, provider: providerName = 'claude' } = await req.json() as {
      chatId?: string;
      provider?: string;
    };

    if (!chatId) {
      return Response.json({ error: 'chatId required' }, { status: 400 });
    }

    const provider = getProvider(providerName);
    provider.clearSession(chatId);

    return Response.json({ ok: true, chatId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
