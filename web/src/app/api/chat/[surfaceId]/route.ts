import { NextRequest } from 'next/server';
import { getProvider, getAvailableProviders } from '@/lib/providers';
import { getSurfaceConfig, getAvailableSurfaces } from '@/lib/surfaces';
import { getOrCreateComposioSession, buildComposioMcpServers } from '@/lib/composio';
import { createSSEStream } from '@/lib/sse';

export const runtime = 'nodejs';

/**
 * Surface-routed chat endpoint.
 * POST /api/chat/:surfaceId
 *
 * Loads the surface config for the given surfaceId, initializes Composio
 * session, and streams SSE chunks from the selected provider.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ surfaceId: string }> },
) {
  const { surfaceId } = await params;

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
    personalPreferences = null,
    displayName = null,
    attachments = null,
    webSearch = false,
    projectInstructions = null,
    projectKnowledge = null,
    apiKey = null,
  } = body as {
    message?: string;
    chatId?: string;
    userId?: string;
    provider?: string;
    model?: string | null;
    personalPreferences?: string | null;
    displayName?: string | null;
    attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' }> | null;
    webSearch?: boolean;
    projectInstructions?: string | null;
    projectKnowledge?: string | null;
    apiKey?: string | null;
  };

  console.log('[CHAT] Surface request received:', surfaceId);
  console.log('[CHAT] Message:', message);
  console.log('[CHAT] Chat ID:', chatId);
  console.log('[CHAT] Provider:', providerName);
  console.log('[CHAT] Model:', model || '(default)');

  // Validate surfaceId
  const availableSurfaces = getAvailableSurfaces();
  if (!availableSurfaces.includes(surfaceId.toLowerCase())) {
    return Response.json(
      { error: `Invalid surface: ${surfaceId}. Available: ${availableSurfaces.join(', ')}` },
      { status: 400 },
    );
  }

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
    // Heartbeat interval
    const heartbeatInterval = setInterval(async () => {
      await sse.writeHeartbeat();
    }, 15000);

    try {
      await sse.writeEvent({ type: 'connected', message: 'Processing request...' });

      // Get or create Composio session for this user
      let composioSession;
      try {
        await sse.writeEvent({ type: 'status', message: 'Initializing session...' });
        composioSession = await getOrCreateComposioSession(userId as string);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[COMPOSIO] Session error:', errMsg);
        // Continue without Composio if it fails
      }

      // Get the provider instance
      const provider = getProvider(providerName as string);

      // Build MCP servers config
      const mcpServers = composioSession
        ? buildComposioMcpServers(composioSession)
        : {};

      // Get surface-specific config
      const surfaceConfig = getSurfaceConfig(surfaceId);

      // Inject user preferences into system prompt context
      const userContext: string[] = [];
      if (displayName) userContext.push(`The user's name is ${displayName}.`);
      if (personalPreferences) userContext.push(personalPreferences);
      const userContextStr = userContext.length > 0 ? userContext.join(' ') : null;

      console.log('[CHAT] Using provider:', provider.name, '| Surface:', surfaceId);
      if (userContextStr) console.log('[CHAT] User context injected:', userContextStr.substring(0, 80));
      console.log('[CHAT] Surface tools:', surfaceConfig.allowedTools?.join(', '));

      // Build system prompt, optionally appending user context
      let systemPrompt = surfaceConfig.systemPrompt;
      if (userContextStr && typeof systemPrompt === 'string') {
        systemPrompt = `${systemPrompt}\n\n${userContextStr}`;
      } else if (userContextStr && typeof systemPrompt === 'object' && systemPrompt !== null) {
        systemPrompt = {
          ...systemPrompt,
          append: (systemPrompt.append ? systemPrompt.append + '\n\n' : '') + userContextStr,
        };
      } else if (userContextStr) {
        systemPrompt = userContextStr;
      }

      // Inject project context into system prompt if available
      if (projectInstructions || projectKnowledge) {
        const projectContext: string[] = [];
        if (projectInstructions) {
          projectContext.push(`<project-instructions>\n${projectInstructions}\n</project-instructions>`);
        }
        if (projectKnowledge) {
          projectContext.push(`<project-knowledge>\n${projectKnowledge}\n</project-knowledge>`);
        }
        const projectContextStr = projectContext.join('\n\n');

        if (typeof systemPrompt === 'string') {
          systemPrompt = `${systemPrompt}\n\n${projectContextStr}`;
        } else if (typeof systemPrompt === 'object' && systemPrompt !== null) {
          systemPrompt = {
            ...systemPrompt,
            append: (systemPrompt.append ? systemPrompt.append + '\n\n' : '') + projectContextStr,
          };
        } else {
          systemPrompt = projectContextStr;
        }
      }

      // Stream responses from the provider
      try {
        for await (const chunk of provider.query({
          prompt: message as string,
          chatId: chatId as string,
          userId: userId as string,
          mcpServers,
          model: (model as string) || surfaceConfig.model,
          surfaceId,
          allowedTools: surfaceConfig.allowedTools,
          maxTurns: surfaceConfig.maxTurns,
          systemPrompt,
          attachments: attachments || undefined,
          webSearch: webSearch || undefined,
          apiKey: (apiKey as string) || undefined,
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

      console.log('[CHAT] Stream completed for surface:', surfaceId);
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
