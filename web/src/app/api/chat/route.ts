import { NextRequest } from 'next/server';
import { getProvider, getAvailableProviders } from '@/lib/providers';
import { createSSEStream } from '@/lib/sse';

export const runtime = 'nodejs';

/**
 * Legacy chat endpoint (no surface routing).
 * POST /api/chat
 *
 * Uses hardcoded tool list and maxTurns. Prefer /api/chat/:surfaceId
 * for surface-routed requests.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    message,
    chatId,
    userId = 'default-user',
    provider: providerName = 'claude',
    model = null,
  } = body as {
    message?: string;
    chatId?: string;
    userId?: string;
    provider?: string;
    model?: string | null;
  };

  console.log('[CHAT] Request received:', message);
  console.log('[CHAT] Chat ID:', chatId);
  console.log('[CHAT] Provider:', providerName);
  console.log('[CHAT] Model:', model || '(default)');

  if (!message) {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }

  // Validate provider
  const availableProviders = getAvailableProviders();
  if (!availableProviders.includes((providerName as string).toLowerCase())) {
    return Response.json(
      { error: `Invalid provider: ${providerName}. Available: ${availableProviders.join(', ')}` },
      { status: 400 },
    );
  }

  const sse = createSSEStream();

  // Stream in background
  (async () => {
    const heartbeatInterval = setInterval(async () => {
      await sse.writeHeartbeat();
    }, 15000);

    try {
      await sse.writeEvent({ type: 'connected', message: 'Processing request...' });

      // Get the provider instance
      const provider = getProvider(providerName as string);

      const mcpServers = {};

      console.log('[CHAT] Using provider:', provider.name);
      console.log('[CHAT] All stored sessions:', Array.from(provider.sessions.entries()));

      // Stream responses from the provider
      try {
        for await (const chunk of provider.query({
          prompt: message as string,
          chatId: chatId as string,
          userId: userId as string,
          mcpServers,
          model: model as string | undefined,
          allowedTools: [
            'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
            'WebSearch', 'WebFetch', 'TodoWrite', 'Skill',
          ],
          maxTurns: 100,
        })) {
          if (chunk.type === 'tool_use') {
            console.log('[SSE] Sending tool_use:', chunk.name);
          }
          if (chunk.type === 'text') {
            console.log('[SSE] Sending text chunk, length:', chunk.content?.length || 0);
          }
          await sse.writeEvent(chunk);
        }
      } catch (streamError: unknown) {
        const errMsg = streamError instanceof Error ? streamError.message : String(streamError);
        console.error('[CHAT] Stream error during iteration:', errMsg);
        await sse.writeEvent({ type: 'error', message: errMsg });
      }

      console.log('[CHAT] Stream completed');
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[CHAT] Error:', errMsg);
      await sse.writeEvent({ type: 'error', message: errMsg });
    } finally {
      clearInterval(heartbeatInterval);
      await sse.close();
    }
  })();

  return sse.toResponse();
}
