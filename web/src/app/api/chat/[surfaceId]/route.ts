import { NextRequest } from 'next/server';
import { getProvider, getAvailableProviders } from '@/lib/providers';
import { getSurfaceConfig, getAvailableSurfaces } from '@/lib/surfaces';
import { getOrCreateComposioSession, buildComposioMcpServers } from '@/lib/composio';
import { createSSEStream } from '@/lib/sse';
import { isGatewayConfigured } from '@/lib/gateway-env';
import { GatewayProvider } from '@/lib/providers/gateway-provider';
import { extractMemories } from '@/lib/memory/extractor';

// ── Request validation limits ─────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 100_000;
const MAX_PREFERENCES_LENGTH = 10_000;
const MAX_INSTRUCTIONS_LENGTH = 50_000;
const MAX_KNOWLEDGE_LENGTH = 200_000;
const MAX_MEMORIES_LENGTH = 20_000;
const MAX_CROSS_SURFACE_LENGTH = 50_000;
const MAX_ATTACHMENTS = 20;
const MAX_HISTORY_LENGTH = 200;

type SystemPrompt = string | { type: string; preset: string; append?: string };

/**
 * Append content to a system prompt that may be a string, an object with `append`, or null.
 * Returns the updated system prompt in the same shape.
 */
function appendToSystemPrompt(
  systemPrompt: SystemPrompt | null | undefined,
  content: string,
): SystemPrompt {
  if (typeof systemPrompt === 'string') {
    return `${systemPrompt}\n\n${content}`;
  }
  if (typeof systemPrompt === 'object' && systemPrompt !== null) {
    return {
      ...systemPrompt,
      append: (systemPrompt.append ? systemPrompt.append + '\n\n' : '') + content,
    };
  }
  // null/undefined — content becomes the prompt
  return content;
}

export const runtime = 'nodejs';

// Singleton gateway provider — cached on globalThis so message history survives hot reload
declare global {
  // eslint-disable-next-line no-var
  var __gatewayProvider: GatewayProvider | undefined;
}
function getGatewayInstance(): GatewayProvider {
  if (!globalThis.__gatewayProvider) {
    globalThis.__gatewayProvider = new GatewayProvider();
  }
  return globalThis.__gatewayProvider;
}

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
    cwd = null,
    history = null,
    memories = null,
    crossSurfaceContext = null,
    autoExtractMemories = true,
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
    cwd?: string | null;
    history?: Array<{ role: 'user' | 'assistant'; content: string }> | null;
    memories?: string | null;
    crossSurfaceContext?: string | null;
    autoExtractMemories?: boolean;
  };

  console.log('[CHAT] Surface request received:', surfaceId);
  console.log('[CHAT] Message:', message);
  console.log('[CHAT] Chat ID:', chatId);
  if (cwd) console.log('[CHAT] Working directory:', cwd);
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

  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'Message is required and must be a string' }, { status: 400 });
  }
  if ((message as string).length > MAX_MESSAGE_LENGTH) {
    return Response.json({ error: `Message exceeds max length (${MAX_MESSAGE_LENGTH} chars)` }, { status: 400 });
  }
  if (personalPreferences && typeof personalPreferences === 'string' && personalPreferences.length > MAX_PREFERENCES_LENGTH) {
    return Response.json({ error: 'Personal preferences too long' }, { status: 400 });
  }
  if (projectInstructions && typeof projectInstructions === 'string' && projectInstructions.length > MAX_INSTRUCTIONS_LENGTH) {
    return Response.json({ error: 'Project instructions too long' }, { status: 400 });
  }
  if (projectKnowledge && typeof projectKnowledge === 'string' && projectKnowledge.length > MAX_KNOWLEDGE_LENGTH) {
    return Response.json({ error: 'Project knowledge too long' }, { status: 400 });
  }
  if (memories && typeof memories === 'string' && memories.length > MAX_MEMORIES_LENGTH) {
    return Response.json({ error: 'Memories payload too long' }, { status: 400 });
  }
  if (crossSurfaceContext && typeof crossSurfaceContext === 'string' && crossSurfaceContext.length > MAX_CROSS_SURFACE_LENGTH) {
    return Response.json({ error: 'Cross-surface context too long' }, { status: 400 });
  }
  if (attachments && Array.isArray(attachments) && attachments.length > MAX_ATTACHMENTS) {
    return Response.json({ error: `Too many attachments (max ${MAX_ATTACHMENTS})` }, { status: 400 });
  }
  if (history && Array.isArray(history) && history.length > MAX_HISTORY_LENGTH) {
    return Response.json({ error: `History too long (max ${MAX_HISTORY_LENGTH} messages)` }, { status: 400 });
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

      // Get the provider instance.
      // Chat surface: use lightweight GatewayProvider (OpenAI SDK, no tools needed).
      // Cowork/Code surfaces: use ClaudeProvider with gateway env (needs agentic tool execution).
      const useGateway = isGatewayConfigured(apiKey as string | null) && surfaceId === 'chat';
      const provider = useGateway
        ? getGatewayInstance()
        : getProvider(providerName as string);
      if (useGateway) console.log('[CHAT] Using nib AI Studio gateway provider (chat-only)');

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

      // Build system prompt with clear injection order:
      // base prompt > user context > project instructions > project knowledge > memories > cross-surface context
      let systemPrompt = surfaceConfig.systemPrompt;

      if (userContextStr) {
        systemPrompt = appendToSystemPrompt(systemPrompt, userContextStr);
      }

      if (projectInstructions) {
        systemPrompt = appendToSystemPrompt(systemPrompt, `<project-instructions>\n${projectInstructions}\n</project-instructions>`);
      }

      if (projectKnowledge) {
        systemPrompt = appendToSystemPrompt(systemPrompt, `<project-knowledge>\n${projectKnowledge}\n</project-knowledge>`);
      }

      if (memories) {
        systemPrompt = appendToSystemPrompt(systemPrompt, memories);
      }

      if (crossSurfaceContext) {
        systemPrompt = appendToSystemPrompt(systemPrompt, crossSurfaceContext);
      }

      // Build onInputRequest callback to forward AskUserQuestion to the client
      const onInputRequest = async (toolUseId: string, questions: unknown) => {
        await sse.writeEvent({
          type: 'input_request',
          toolUseId,
          questions,
        });
      };

      // Stream responses from the provider
      let collectedResponse = '';
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
          cwd: (cwd as string) || undefined,
          history: history || undefined,
          onInputRequest,
        })) {
          if (chunk.type === 'tool_use') {
            console.log('[SSE] Sending tool_use:', chunk.name);
          }
          if (chunk.type === 'text') {
            console.log('[SSE] Sending text chunk, length:', chunk.content?.length || 0);
            collectedResponse += (chunk.content as string) || '';
          }
          await sse.writeEvent(chunk);
        }
      } catch (streamError: unknown) {
        const errMsg = streamError instanceof Error ? streamError.message : String(streamError);
        console.error('[CHAT] Stream error during iteration:', errMsg);
        await sse.writeEvent({ type: 'error', message: errMsg });
      }

      // Auto-extract memories after stream completes
      if (autoExtractMemories && collectedResponse.length >= 50) {
        try {
          const extracted = await extractMemories(
            message as string,
            collectedResponse,
            (apiKey as string) || undefined,
          );
          if (extracted.length > 0) {
            await sse.writeEvent({
              type: 'memory_extract',
              memories: extracted,
            });
            console.log('[MEMORY] Extracted', extracted.length, 'memories');
          }
        } catch (extractErr) {
          console.error('[MEMORY] Extraction error:', extractErr);
          // Non-fatal — don't send error to client
        }
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
