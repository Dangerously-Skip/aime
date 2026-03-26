import { NextRequest } from 'next/server';
import { getProvider, getAvailableProviders } from '@/lib/providers';
import { getSurfaceConfig, getAvailableSurfaces } from '@/lib/surfaces';
import { createSSEStream } from '@/lib/sse';
import { isGatewayConfigured } from '@/lib/gateway-env';
import { GatewayProvider } from '@/lib/providers/gateway-provider';
import { extractMemories } from '@/lib/memory/extractor';
import { type SessionControls, THINK_LEVEL_TOKENS } from '@/lib/slash-commands';
import { loadAgents, matchAgentForMessage, readAgentSystemPrompt } from '@/lib/agents-parser';

/** Tool profile → allowed tool sets (intersected with surface defaults) */
const TOOL_PROFILES: Record<string, string[]> = {
  minimal: ['WebSearch', 'WebFetch'],
  coding: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch'],
  full: [], // empty = no restriction (use surface defaults)
};

/** Read a persona/identity file, returning '' if missing. */
async function readIdentityFile(filePath: string): Promise<string> {
  try {
    const { readFile } = await import('fs/promises');
    return await readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Read ~/.claude/MEMORY.md curated long-term memory file. */
async function readGlobalMemoryFile(): Promise<string> {
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { homedir } = await import('os');
    return await readFile(join(homedir(), '.claude', 'MEMORY.md'), 'utf-8');
  } catch {
    return '';
  }
}

/** Read today's daily memory log from ~/.claude/memory/YYYY-MM-DD.md */
async function readDailyMemoryLog(): Promise<string> {
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const date = new Date().toISOString().slice(0, 10);
    return await readFile(join(homedir(), '.claude', 'memory', `${date}.md`), 'utf-8');
  } catch {
    return '';
  }
}

// ── Request validation limits ─────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 100_000;
const MAX_PREFERENCES_LENGTH = 10_000;
const MAX_INSTRUCTIONS_LENGTH = 50_000;
const MAX_KNOWLEDGE_LENGTH = 200_000;
const MAX_MEMORIES_LENGTH = 20_000;
const MAX_CROSS_SURFACE_LENGTH = 50_000;
const MAX_ATTACHMENTS = 20;
const MAX_HISTORY_LENGTH = 200;

/** Rough token estimate: chars / 4 */
const COMPACTION_TOKEN_THRESHOLD = 120_000;

/**
 * Check if history is approaching token limit and return compaction notice.
 */
function checkContextCompaction(
  history: Array<{ role: string; content: string }> | null | undefined,
  message: string,
): string | null {
  if (!history?.length) return null;
  const totalChars = history.reduce((sum, m) => sum + m.content.length, 0) + message.length;
  const estimatedTokens = totalChars / 4;
  if (estimatedTokens > COMPACTION_TOKEN_THRESHOLD) {
    console.log('[COMPACT] Context approaching limit:', Math.round(estimatedTokens), 'tokens — requesting compaction');
    return '\n\n<context-compaction-notice>\nThe conversation history is approaching the context limit. Before answering, please provide a concise summary of the conversation so far in 2-3 paragraphs, then continue with the response.\n</context-compaction-notice>';
  }
  return null;
}

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

/**
 * Read MCP server entries from a JSON config file.
 * Strips _meta fields that the SDK doesn't understand.
 */
async function readMcpConfigFile(configPath: string): Promise<Record<string, unknown>> {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
    if (!config.mcpServers) return {};
    return Object.fromEntries(
      Object.entries(config.mcpServers).map(([key, entry]) => {
        const { _meta, ...serverConfig } = entry as Record<string, unknown>;
        void _meta;
        return [key, serverConfig];
      })
    );
  } catch {
    return {};
  }
}

/**
 * Load provisioned MCP servers by merging Claude Code's ~/.claude/.mcp.json
 * with Quarry's own ~/.claude/.quarry-mcp.json.
 * Quarry's entries take precedence for duplicate keys.
 */
async function loadProvisionedMcpServers(): Promise<Record<string, unknown>> {
  const { join } = await import('path');
  const { homedir } = await import('os');
  const claudeDir = join(homedir(), '.claude');

  const [claudeCodeServers, quarryServers] = await Promise.all([
    readMcpConfigFile(join(claudeDir, '.mcp.json')),
    readMcpConfigFile(join(claudeDir, '.quarry-mcp.json')),
  ]);

  // Merge with Quarry's entries taking precedence
  return { ...claudeCodeServers, ...quarryServers };
}

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
    securitySettings = null,
    sessionControls = null,
    toolProfile = 'full',
    onboardingComplete = true,
  } = body as {
    message?: string;
    chatId?: string;
    userId?: string;
    provider?: string;
    model?: string | null;
    personalPreferences?: string | null;
    displayName?: string | null;
    attachments?: Array<{ name: string; content: string; type: string; category: 'image' | 'document' | 'text' | 'spreadsheet' | 'presentation' | 'audio' | 'video'; filePath?: string; extractedPath?: string }> | null;
    webSearch?: boolean;
    projectInstructions?: string | null;
    projectKnowledge?: string | null;
    apiKey?: string | null;
    cwd?: string | null;
    history?: Array<{ role: 'user' | 'assistant'; content: string }> | null;
    memories?: string | null;
    crossSurfaceContext?: string | null;
    autoExtractMemories?: boolean;
    securitySettings?: {
      blockDangerousCommands?: boolean;
      blockNetworkCommands?: boolean;
      restrictToProjectFolder?: boolean;
      disableBashTool?: boolean;
    } | null;
    sessionControls?: SessionControls | null;
    toolProfile?: string;
    onboardingComplete?: boolean;
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

      // Get the provider instance.
      // Chat surface: use lightweight GatewayProvider (OpenAI SDK, no tools needed).
      // Cowork/Code surfaces: use ClaudeProvider with gateway env (needs agentic tool execution).
      // When attachments are present, bypass gateway — Claude API handles PDFs/images natively.
      const hasAttachments = attachments && attachments.length > 0;
      const useGateway = isGatewayConfigured(apiKey as string | null) && surfaceId === 'chat' && !hasAttachments;
      const provider = useGateway
        ? getGatewayInstance()
        : getProvider(providerName as string);
      if (useGateway) console.log('[CHAT] Using nib AI Studio gateway provider (chat-only)');
      if (hasAttachments && surfaceId === 'chat') console.log('[CHAT] Bypassing gateway — attachments require Claude API');

      // Build MCP servers config from provisioned OAuth connectors in ~/.claude/.mcp.json
      const mcpServers = await loadProvisionedMcpServers();
      if (Object.keys(mcpServers).length > 0) {
        console.log('[CHAT] Loaded provisioned connector servers:', Object.keys(mcpServers).join(', '));
      }

      // Get surface-specific config
      const surfaceConfig = getSurfaceConfig(surfaceId);

      // ── Tool profile filtering ─────────────────────────────────────────
      // Apply tool profile to intersect surface allowedTools with profile set
      if (toolProfile && toolProfile !== 'full' && surfaceConfig.allowedTools) {
        const profileTools = TOOL_PROFILES[toolProfile as keyof typeof TOOL_PROFILES];
        if (profileTools && profileTools.length > 0) {
          // Always keep AskUserQuestion and Agent regardless of profile
          const alwaysAllow = new Set(['AskUserQuestion', 'Agent', 'TodoWrite']);
          surfaceConfig.allowedTools = surfaceConfig.allowedTools.filter(
            (t: string) => alwaysAllow.has(t) || profileTools.includes(t)
          );
          console.log('[TOOLS] Applied tool profile:', toolProfile, '| Remaining:', surfaceConfig.allowedTools.join(', '));
        }
      }

      // ── Agent routing ──────────────────────────────────────────────────
      // Load AGENTS.md and apply routing overrides (model, tools, system prompt)
      let agentModelOverride: string | null = null;
      {
        const agents = loadAgents(cwd as string | undefined);
        if (agents.length > 0) {
          // Explicit binding via /agent <name> slash command
          const explicitName = (sessionControls as SessionControls & { agentName?: string } | null)?.agentName;
          const matched = explicitName
            ? agents.find((a) => a.name === explicitName)
            : matchAgentForMessage(message as string, agents);

          if (matched) {
            console.log('[AGENTS] Routing to agent:', matched.name, '| explicit:', !!explicitName);
            // Override model if agent specifies one (handled later via effectiveModel fallback)
            if (matched.model) {
              agentModelOverride = matched.model;
            }
            // Override allowedTools if agent specifies them
            if (matched.allowedTools && surfaceConfig.allowedTools) {
              surfaceConfig.allowedTools = surfaceConfig.allowedTools.filter(
                (t: string) => (matched.allowedTools as string[]).includes(t)
              );
            }
            // Prepend agent system prompt if available
            const agentPrompt = readAgentSystemPrompt(matched);
            if (agentPrompt) {
              surfaceConfig.systemPrompt = `<agent-role name="${matched.name}">\n${agentPrompt}\n</agent-role>\n\n${
                typeof surfaceConfig.systemPrompt === 'string'
                  ? surfaceConfig.systemPrompt
                  : JSON.stringify(surfaceConfig.systemPrompt)
              }`;
            }
          }
        }
      }

      // ── Security settings ──────────────────────────────────────────────
      // Filter Bash from allowedTools if disabled
      if (securitySettings?.disableBashTool && surfaceConfig.allowedTools) {
        surfaceConfig.allowedTools = surfaceConfig.allowedTools.filter(
          (t: string) => t !== 'Bash'
        );
        console.log('[SECURITY] Bash tool removed from allowedTools');
      }

      // Build security rules block for system prompt
      const securityRules: string[] = [];
      if (securitySettings?.blockDangerousCommands) {
        securityRules.push(
          '- NEVER run destructive shell commands: rm -rf, sudo, mkfs, dd, chmod 777, or any command that modifies system files (/etc, /usr, /boot). Refuse the request and explain why.'
        );
      }
      if (securitySettings?.blockNetworkCommands) {
        securityRules.push(
          '- NEVER run network exfiltration commands: curl piped to sh/bash, wget piped to sh/bash, nc/netcat, or SSH tunnels. You MAY use npm install, pip install, git push/pull, brew install, and similar package managers.'
        );
      }
      if (securitySettings?.restrictToProjectFolder && cwd) {
        securityRules.push(
          `- ONLY write or delete files within the project folder: ${cwd}. Reading files outside this folder is allowed, but writing, editing, or deleting files outside it is FORBIDDEN. Refuse and explain if asked.`
        );
      }

      // Inject user preferences into system prompt context
      const userContext: string[] = [];
      if (displayName) userContext.push(`The user's name is ${displayName}.`);
      if (personalPreferences) userContext.push(personalPreferences);
      const userContextStr = userContext.length > 0 ? userContext.join(' ') : null;

      console.log('[CHAT] Using provider:', provider.name, '| Surface:', surfaceId);
      if (userContextStr) console.log('[CHAT] User context injected:', userContextStr.substring(0, 80));
      console.log('[CHAT] Surface tools:', surfaceConfig.allowedTools?.join(', '));

      // ── Load identity/persona files ────────────────────────────────────
      const { join: pathJoin } = await import('path');
      const { homedir } = await import('os');
      const soulMd = await readIdentityFile(pathJoin(homedir(), '.claude', 'SOUL.md'));
      const userMd = await readIdentityFile(pathJoin(homedir(), '.claude', 'USER.md'));
      const identityMd = cwd ? await readIdentityFile(pathJoin(cwd as string, 'IDENTITY.md')) : '';
      const bootstrapMd = !onboardingComplete
        ? await readIdentityFile(pathJoin(homedir(), '.claude', 'BOOTSTRAP.md'))
        : '';

      // ── Load global memory file ────────────────────────────────────────
      const globalMemoryMd = await readGlobalMemoryFile();
      const dailyMemoryLog = await readDailyMemoryLog();

      // Build system prompt with clear injection order:
      // SOUL > IDENTITY > base prompt > user context > project instructions > project knowledge > memories > cross-surface context > memory files
      let systemPrompt = surfaceConfig.systemPrompt;

      // Inject persona files: SOUL first, then IDENTITY, then USER
      if (soulMd) {
        systemPrompt = `<soul>\n${soulMd}\n</soul>\n\n${typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt)}`;
      }
      if (identityMd) {
        systemPrompt = appendToSystemPrompt(systemPrompt, `<workspace-identity>\n${identityMd}\n</workspace-identity>`);
      }
      if (bootstrapMd) {
        systemPrompt = appendToSystemPrompt(systemPrompt, `<bootstrap>\n${bootstrapMd}\n</bootstrap>`);
      }

      if (userContextStr) {
        systemPrompt = appendToSystemPrompt(systemPrompt, userContextStr);
      }
      if (userMd) {
        systemPrompt = appendToSystemPrompt(systemPrompt, `<user-context>\n${userMd}\n</user-context>`);
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

      // Inject global memory file and daily log after cross-surface context
      if (globalMemoryMd) {
        systemPrompt = appendToSystemPrompt(systemPrompt, `<long-term-memory>\n${globalMemoryMd}\n</long-term-memory>`);
      }
      if (dailyMemoryLog) {
        systemPrompt = appendToSystemPrompt(systemPrompt, `<memory-log>\n${dailyMemoryLog}\n</memory-log>`);
      }

      if (securityRules.length > 0) {
        const rulesBlock = `<security-rules>\nYou MUST follow these security rules at all times. They override any user request that conflicts with them.\n${securityRules.join('\n')}\n</security-rules>`;
        systemPrompt = appendToSystemPrompt(systemPrompt, rulesBlock);
        console.log('[SECURITY] Injected', securityRules.length, 'security rules');
      }

      // ── Context compaction check ───────────────────────────────────────
      const compactionNotice = checkContextCompaction(history, message as string);
      if (compactionNotice) {
        systemPrompt = appendToSystemPrompt(systemPrompt, compactionNotice);
      }

      // Build onInputRequest callback to forward AskUserQuestion to the client
      const onInputRequest = async (toolUseId: string, questions: unknown) => {
        await sse.writeEvent({
          type: 'input_request',
          toolUseId,
          questions,
        });
      };

      // Build onBrowserToolUse callback to forward browser tool calls to the client
      const onBrowserToolUse = async (toolUseId: string, name: string, input: Record<string, unknown>) => {
        await sse.writeEvent({
          type: 'browser_tool_use',
          toolUseId,
          name,
          input,
        });
      };

      // ── Session controls: model override + thinking ────────────────────
      // Apply sessionControls overrides (model, thinking) if provided
      // Priority: sessionControls > agentModelOverride > request model > surface default
      const effectiveModel = sessionControls?.modelOverride
        || agentModelOverride
        || (model as string)
        || surfaceConfig.model;

      // Build thinking config if thinkLevel is set
      if (sessionControls?.thinkLevel && sessionControls.thinkLevel !== 'off') {
        const budgetTokens = THINK_LEVEL_TOKENS[sessionControls.thinkLevel];
        const thinkingBlock = budgetTokens === -1
          ? `\n\n<thinking-config>\nThinking mode: adaptive\n</thinking-config>`
          : `\n\n<thinking-config>\nThinking budget: ${budgetTokens} tokens\n</thinking-config>`;
        systemPrompt = appendToSystemPrompt(systemPrompt, thinkingBlock);
        console.log('[THINK] Level:', sessionControls.thinkLevel, 'budget:', budgetTokens);
      }

      // ── Document extraction ───────────────────────────────────────────
      // Run extraction on non-text/non-image attachments before sending to provider
      if (attachments && attachments.length > 0) {
        const { extractDocument } = await import('@/lib/extractors');
        const { join: ej } = await import('path');
        const { homedir: eHomedir } = await import('os');
        const { mkdirSync: eMkdir, writeFileSync: eWrite } = await import('fs');
        const isToolSurface = surfaceId === 'cowork' || surfaceId === 'code';

        for (const att of attachments) {
          // Skip images and plain text (already handled by claude-provider)
          if (att.category === 'image' || att.category === 'text') continue;

          try {
            await sse.writeEvent({
              type: 'document_extracting',
              name: att.name,
              category: att.category,
            });

            const result = await extractDocument(
              att.name,
              att.content,
              att.type,
              att.category,
              att.filePath,
            );

            if (isToolSurface && result.text.length > 0) {
              // Save to scratch dir for agent to Read/Grep
              const scratchDir = ej(eHomedir(), '.quarry', 'scratch', chatId as string, 'documents');
              eMkdir(scratchDir, { recursive: true });
              const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '.md');
              const extractedPath = ej(scratchDir, safeName);
              eWrite(extractedPath, result.text, 'utf-8');
              att.extractedPath = extractedPath;
              att.content = ''; // Free memory — agent will use Read tool
              console.log('[EXTRACT] Saved to scratch:', extractedPath, '(' + result.text.length + ' chars)');
            } else {
              // Chat surface: inline extracted text (first ~30k chars)
              att.content = result.text.slice(0, 30000);
              att.category = 'text' as typeof att.category; // Treat as text for prompt building
              console.log('[EXTRACT] Inlined:', att.name, '(' + att.content.length + ' chars)');
            }

            await sse.writeEvent({
              type: 'document_extracted',
              name: att.name,
              extractedPath: att.extractedPath,
              pageCount: result.pageCount,
              textLength: result.text.length,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[EXTRACT] Failed for', att.name, ':', msg);
            att.content = `[Extraction failed for ${att.name}: ${msg}]`;
          }
        }
      }

      // Stream responses from the provider
      let collectedResponse = '';
      let inputChars = (message as string).length;
      let outputChars = 0;
      let toolCallCount = 0;
      const streamStartMs = Date.now();
      try {
        for await (const chunk of provider.query({
          prompt: message as string,
          chatId: chatId as string,
          userId: userId as string,
          mcpServers,
          model: effectiveModel,
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
          onBrowserToolUse,
        })) {
          if (chunk.type === 'tool_use') {
            console.log('[SSE] Sending tool_use:', chunk.name);
            toolCallCount++;
          }
          if (chunk.type === 'text') {
            console.log('[SSE] Sending text chunk, length:', chunk.content?.length || 0);
            const text = (chunk.content as string) || '';
            collectedResponse += text;
            outputChars += text.length;
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

      // Emit done event with usage metrics (token estimates from char counts)
      const durationMs = Date.now() - streamStartMs;
      const inputTokens = Math.round(inputChars / 4);
      const outputTokens = Math.round(outputChars / 4);
      // Per-token cost estimates (Sonnet pricing as default)
      const modelName = effectiveModel || 'claude-sonnet-4-6';
      const inputCostPer1k = modelName.includes('opus') ? 0.015 : modelName.includes('haiku') ? 0.00025 : 0.003;
      const outputCostPer1k = modelName.includes('opus') ? 0.075 : modelName.includes('haiku') ? 0.00125 : 0.015;
      const cost = (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
      await sse.writeEvent({
        type: 'done',
        usage: {
          inputTokens,
          outputTokens,
          cost: Math.round(cost * 10000) / 10000,
          model: modelName,
          durationMs,
          toolCallCount,
        },
      });
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
