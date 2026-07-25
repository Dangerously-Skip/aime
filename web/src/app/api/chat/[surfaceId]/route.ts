import { NextRequest } from 'next/server';
import { getProvider, getAvailableProviders } from '@/lib/providers';
import { getSurfaceConfig, getAvailableSurfaces } from '@/lib/surfaces';
import { createSSEStream } from '@/lib/sse';
import { extractMemories } from '@/lib/memory/extractor';
import { type SessionControls } from '@/lib/slash-commands';
import { loadAgents, matchAgentForMessage, readAgentSystemPrompt } from '@/lib/agents-parser';
import { loadProvisionedMcpServers } from '@/lib/mcp/provisioned';

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
    contextBusEvents = null,
    autoExtractMemories = true,
    securitySettings = null,
    sessionControls = null,
    toolProfile = 'full',
    onboardingComplete = true,
    capability = null,
    tier = null,
    providerConfig = null,
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
    contextBusEvents?: Array<{ summary: string; source: string; priority: string }> | null;
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
    capability?: import('@/lib/models/types').Capability | null;
    tier?: import('@/lib/models/types').Tier | null;
    providerConfig?: import('@/lib/models/execution').ProviderExecConfig | null;
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

      // All surfaces use ClaudeProvider (Agent SDK) for consistent tool access,
      // connector support, and session management. Gateway routing for billing is
      // handled inside ClaudeProvider via ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL env vars.
      const provider = getProvider(providerName as string);

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

      // ── Canvas templates ──────────────────────────────────────────────
      // Inject available canvas templates into the system prompt so the agent
      // can pick a templated payload instead of authoring full A2UI JSON.
      if (surfaceConfig.allowedTools?.includes('mcp__aime__canvas') || surfaceConfig.allowedTools?.includes('canvas')) {
        const { buildCanvasTemplatesPrompt } = await import('@/lib/canvas/templates');
        const templatesPrompt = buildCanvasTemplatesPrompt(surfaceId);
        if (templatesPrompt) {
          surfaceConfig.systemPrompt = `${
            typeof surfaceConfig.systemPrompt === 'string'
              ? surfaceConfig.systemPrompt
              : JSON.stringify(surfaceConfig.systemPrompt)
          }\n\n${templatesPrompt}`;
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

      // Inject context bus events (background alerts from standing orders)
      if (contextBusEvents && contextBusEvents.length > 0) {
        const alertsBlock = contextBusEvents.map((e) =>
          `[${e.priority.toUpperCase()} — ${e.source}] ${e.summary}`
        ).join('\n');
        systemPrompt = appendToSystemPrompt(systemPrompt, `<background-alerts>\nThe following background events occurred while you were idle. Acknowledge them if relevant to the user's current request.\n${alertsBlock}\n</background-alerts>`);
        console.log('[CHAT] Injected', contextBusEvents.length, 'context bus events');
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

      // ── Model resolution ───────────────────────────────────────────────
      // Priority: explicit model (sessionControls > agent > request) wins.
      // Otherwise, if the client asked by (capability, tier), resolve through
      // the model registry with tumbling. Falls back to the surface default.
      const explicitModel = sessionControls?.modelOverride
        || agentModelOverride
        || (model as string | null)
        || null;
      let effectiveModel = explicitModel || surfaceConfig.model;

      if (!explicitModel) {
        // No pinned model → this surface's default comes from the registry, not
        // a hardcoded name. The surface supplies the (capability, tier) intent
        // (SURFACE_ROUTES); an explicit request capability/tier overrides it —
        // that's how a user's per-surface tier preference arrives.
        const { resolveRoute, createDefaultRegistry } = await import('@/lib/models/registry');
        const { getSurfaceRoute } = await import('@/lib/models/surface-routes');
        const { isBedrockConfigured } = await import('@/lib/bedrock-env');
        // Availability for the default (Claude) registry: an API key (BYOK/env)
        // makes the anthropic provider usable; a region makes Bedrock usable.
        const availableIds = new Set<string>();
        if (apiKey || process.env.ANTHROPIC_API_KEY) availableIds.add('anthropic');
        if (isBedrockConfigured()) availableIds.add('bedrock');

        const route = getSurfaceRoute(surfaceId);
        const wantCapability = capability ?? route.capability;
        const wantTier = tier ?? route.tier;

        const resolved = resolveRoute(
          createDefaultRegistry(),
          wantCapability,
          wantTier,
          (p) => availableIds.has(p.id),
        );
        if (resolved) {
          effectiveModel = resolved.model.driverModel;
          console.log('[CHAT] Registry resolved', wantCapability, wantTier, '→', effectiveModel,
            resolved.degraded ? '(degraded)' : '');
        }
        // else: keep surfaceConfig.model as the last-resort fallback.
      }

      // ── Execution resolution (user-added providers) ────────────────────
      // For a model on a user-added provider, resolve the key (keychain by
      // providerId, or the transient request key) and the Anthropic-compat
      // base URL. No providerConfig ⇒ default BYOK/env/Bedrock path unchanged.
      const { resolveExecution } = await import('@/lib/models/execution');
      const exec = await resolveExecution({
        providerConfig,
        requestApiKey: apiKey,
        // openai-compat providers route through the shim on this same server.
        shimOrigin: new URL(req.url).origin,
        loadKey: async (id) => {
          try {
            const { getCredentialStore } = await import('@/lib/models/credentials');
            return await getCredentialStore().getField(id, 'apiKey');
          } catch {
            // CredentialStoreUnavailable (no AIME_CRED_KEY) or read error →
            // fall back to whatever the request supplied.
            return undefined;
          }
        },
      });
      if (providerConfig) {
        console.log('[CHAT] Provider config:', providerConfig.providerId,
          providerConfig.transport ?? 'anthropic-native',
          exec.baseUrl ? '(custom base URL)' : '');
      }

      // Thinking and effort are now handled natively by the SDK via ClaudeProvider
      // (passed as queryOptions.thinking and queryOptions.effort)

      // ── Document extraction ───────────────────────────────────────────
      // Run extraction on non-text/non-image attachments before sending to provider
      if (attachments && attachments.length > 0) {
        const { extractDocument } = await import('@/lib/extractors');
        const { getScratchDir } = await import('@/lib/app-paths');
        const { join: ej } = await import('path');
        const { mkdirSync: eMkdir, writeFileSync: eWrite } = await import('fs');
        const isToolSurface = surfaceId === 'cowork' || surfaceId === 'code';

        for (const att of attachments) {
          // Skip plain text (already handled by claude-provider inline)
          if (att.category === 'text') continue;

          // Images: save to scratch so the model can use Read tool to view them
          if (att.category === 'image') {
            if (att.content) {
              const imgDir = ej(getScratchDir(chatId as string), 'uploads');
              eMkdir(imgDir, { recursive: true });
              const imgName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
              const imgPath = ej(imgDir, imgName);
              const base64Data = att.content.includes(',') ? att.content.split(',')[1] : att.content;
              eWrite(imgPath, Buffer.from(base64Data, 'base64'));
              att.extractedPath = imgPath;
              att.content = ''; // Free memory
              console.log('[EXTRACT] Saved image to:', imgPath);
            }
            continue;
          }

          // Always save the raw file to scratch so the model can read it if extraction fails
          const scratchDir = ej(getScratchDir(chatId as string), 'uploads');
          eMkdir(scratchDir, { recursive: true });
          const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const savedPath = ej(scratchDir, safeName);

          if (!att.filePath && att.content) {
            // Decode base64 and write to disk
            const rawBuffer = Buffer.from(att.content, 'base64');
            eWrite(savedPath, rawBuffer);
            att.filePath = savedPath;
            console.log('[EXTRACT] Saved raw file to:', savedPath, '(' + rawBuffer.length + ' bytes)');
          } else if (att.filePath) {
            // Already on disk — copy to scratch for consistent path
            const { copyFileSync } = await import('fs');
            try { copyFileSync(att.filePath, savedPath); att.filePath = savedPath; } catch { /* keep original path */ }
          }

          try {
            await sse.writeEvent({
              type: 'document_extracting',
              name: att.name,
              category: att.category,
            });

            console.log('[EXTRACT] Starting extraction:', att.name, 'type:', att.type, 'category:', att.category, 'contentLen:', att.content?.length || 0, 'filePath:', att.filePath || 'none');

            // Wrap extraction in a 30-second timeout
            const extractionPromise = extractDocument(
              att.name,
              att.content,
              att.type,
              att.category,
              att.filePath,
            );
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Extraction timed out after 30 seconds')), 30000)
            );
            const result = await Promise.race([extractionPromise, timeoutPromise]);
            console.log('[EXTRACT] Success:', att.name, 'text length:', result.text.length, 'pages:', result.pageCount || 'n/a');

            // Zero-text extraction is common for image-based PDFs (scanned
            // boarding passes, photo PDFs, etc.). Treat as a failure so the
            // agent gets the file path + a clear note it needs Read/OCR.
            if (result.text.length === 0 && att.filePath) {
              att.content = `[The file ${att.name} appears to be an image-based PDF (no extractable text layer — likely a scan or photo). The raw file is at: ${att.filePath} — use the Read tool to access it.]`;
              att.extractedPath = att.filePath;
              console.log('[EXTRACT] Empty result; falling back to Read tool path for', att.name);
            } else if (isToolSurface && result.text.length > 0) {
              // Save to scratch dir for agent to Read/Grep
              const scratchDir = ej(getScratchDir(chatId as string), 'documents');
              eMkdir(scratchDir, { recursive: true });
              const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '.md');
              const extractedPath = ej(scratchDir, safeName);
              eWrite(extractedPath, result.text, 'utf-8');
              att.extractedPath = extractedPath;
              att.content = ''; // Free memory — agent will use Read tool
              console.log('[EXTRACT] Saved to scratch:', extractedPath, '(' + result.text.length + ' chars)');
            } else {
              // Chat surface with non-empty text: inline (first ~30k chars)
              att.content = result.text.slice(0, 30000);
              att.category = 'text' as typeof att.category;
              console.log('[EXTRACT] Inlined:', att.name, '(' + att.content.length + ' chars)');
            }

            await sse.writeEvent({
              type: 'document_extracted',
              name: att.name,
              extractedPath: att.extractedPath,
              pageCount: result.pageCount,
              textLength: result.text.length,
              // Send extracted text to client so it can persist in conversation history
              ...(surfaceId === 'chat' && result.text.length > 0 ? { extractedText: result.text.slice(0, 30000) } : {}),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[EXTRACT] Failed for', att.name, ':', msg);
            // Fallback: tell the model the file is saved to disk and it can read it directly
            if (att.filePath) {
              att.content = `[Text extraction failed for ${att.name} (${msg}). The raw file has been saved to: ${att.filePath} — use the Read tool to access it.]`;
              att.extractedPath = att.filePath;
              console.log('[EXTRACT] Fallback: model can read file at', att.filePath);
            } else {
              att.content = `[Extraction failed for ${att.name}: ${msg}]`;
            }
          }
        }
      }

      // ClaudeProvider handles attachment inlining into the prompt string.
      const finalMessage = message as string;

      // Stream responses from the provider
      let collectedResponse = '';
      const inputChars = finalMessage.length;
      let outputChars = 0;
      let toolCallCount = 0;
      const streamStartMs = Date.now();
      let queryTimedOut = false;

      // Auto-abort after surface-specific timeout
      const timeoutSecs = surfaceConfig.queryTimeoutSecs || 0;
      let queryTimer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutSecs > 0) {
        queryTimer = setTimeout(async () => {
          queryTimedOut = true;
          console.warn(`[CHAT] Query timeout after ${timeoutSecs}s — aborting`);
          try {
            provider.abort(chatId as string, surfaceId);
          } catch (e) {
            console.error('[CHAT] Abort on timeout failed:', e);
          }
          await sse.writeEvent({ type: 'error', message: `Query timed out after ${timeoutSecs} seconds. Try a simpler request or break it into steps.` });
        }, timeoutSecs * 1000);
      }

      try {
        for await (const chunk of provider.query({
          prompt: finalMessage,
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
          apiKey: exec.apiKey,
          baseUrl: exec.baseUrl,
          cwd: (cwd as string) || undefined,
          history: history || undefined,
          sessionControls: sessionControls || undefined,
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
        if (!queryTimedOut) {
          console.error('[CHAT] Stream error during iteration:', errMsg);
          // Surface every property the SDK might have attached (stderr,
          // exit code, stack, cause). The default Error.message often
          // strips this, leaving us with "process exited with code 1".
          if (streamError instanceof Error) {
            const errObj = streamError as Error & {
              stderr?: string;
              stdout?: string;
              code?: string | number;
              cause?: unknown;
            };
            if (errObj.stderr) console.error('[CHAT] cli.js stderr:', errObj.stderr);
            if (errObj.stdout) console.error('[CHAT] cli.js stdout:', errObj.stdout);
            if (errObj.code !== undefined) console.error('[CHAT] cli.js exit code:', errObj.code);
            if (errObj.cause) console.error('[CHAT] cause:', errObj.cause);
            if (errObj.stack) console.error('[CHAT] stack:', errObj.stack);
          }
          await sse.writeEvent({ type: 'error', message: errMsg });
        }
      } finally {
        if (queryTimer) clearTimeout(queryTimer);
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
