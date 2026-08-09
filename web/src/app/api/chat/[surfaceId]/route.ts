import { NextRequest } from 'next/server';
import { getProvider, getAvailableProviders } from '@/lib/providers';
import { getSurfaceConfig, getAvailableSurfaces } from '@/lib/surfaces';
import { createSSEStream } from '@/lib/sse';
import { extractMemories } from '@/lib/memory/extractor';
import { type SessionControls } from '@/lib/slash-commands';
import { loadAgents, matchAgentForMessage, readAgentSystemPrompt } from '@/lib/agents-parser';
import { loadProvisionedMcpServers } from '@/lib/mcp/provisioned';
import { baseToolName, toolMatches } from '@/lib/security/tool-names';

/** Tool profile → allowed tool sets (intersected with surface defaults) */
const TOOL_PROFILES: Record<string, string[]> = {
  // `mcp__web-search__web_search` is listed alongside `WebSearch` because it IS
  // the web search on every surface — the built-in is unconditionally disallowed
  // by the provider. Omitting it was harmless while the filter was a no-op; now
  // that a profile produces real denials, leaving it out took away the only
  // working search from a profile whose own label promises search.
  //
  // `mcp__aime__SearchWeb` is the same tool for the API-key search providers
  // (Brave/Tavily/OpenRouter); only searxng uses the external MCP above. Both
  // names must appear in every profile that promises search, or which provider
  // the user picked would silently decide whether search survives a profile.
  minimal: ['WebSearch', 'mcp__aime__FetchUrl', 'mcp__web-search__web_search', 'mcp__aime__SearchWeb'],
  coding: [
    'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'Bash',
    'WebSearch', 'mcp__aime__FetchUrl', 'mcp__web-search__web_search', 'mcp__aime__SearchWeb',
    // A coding profile that cannot produce a document or a spreadsheet is not
    // what the label ("Read/Write/Edit/Glob/Grep/Bash + Web tools") promises;
    // these were never enumerated because the list predates them mattering.
    'ExcelRead', 'ExcelWrite', 'ExcelEdit',
    'mcp__aime__DocumentCreate', 'mcp__aime__SkillCreate', 'Skill',
    // Imagery is not deck-specific: a mockup, a landing page and a document all
    // read as unfinished without it, and the profile that builds those is this
    // one. Withholding it here means the model falls back to an invented URL.
    'mcp__aime__CreateImage',
    // iCloud is a capability the user explicitly connected; a tool profile that
    // silently withheld it would look like the connector had stopped working.
    'mcp__aime__MailSearch', 'mcp__aime__MailRead', 'mcp__aime__MailDraft',
    'mcp__aime__CalendarEvents', 'mcp__aime__ContactsSearch',
  ],
  full: [], // empty = no restriction (use surface defaults)
};

/**
 * Never withheld by a profile or an agent's tool list, however narrow.
 *
 * These are how the app talks to itself, not capabilities the user is choosing
 * between: asking a question, tracking a todo, delegating, drawing a canvas,
 * requesting a connector. None of them touches the world. `TOOL_PROFILES` was
 * written as a list of world-side capabilities and never enumerated this
 * plumbing — the pre-existing `AskUserQuestion`/`Agent`/`TodoWrite` carve-out is
 * the same observation, found the same way — so treating a profile as an
 * exhaustive deny list would silently break the connector card and the canvas.
 *
 * Anything that creates, writes or fetches is deliberately NOT here: a user who
 * picks "WebSearch + WebFetch only" should not still get DocumentCreate.
 */
const PLUMBING_TOOLS = new Set([
  'AskUserQuestion',
  'Agent',
  'spawn_agent',
  'TodoWrite',
  'mcp__aime__canvas',
  'mcp__aime__RequestConnector',
]);

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
    searchSettings = null,
    deckTheme = null,
    sessionControls = null,
    toolProfile = 'full',
    maxTurns: requestedMaxTurns = null,
    maxBudgetUsd: requestedBudgetUsd = null,
    denyTools: requestedDenyTools = null,
    onboardingComplete = true,
    capability = null,
    tier = null,
    providerConfig = null,
    canRelayToClient = true,
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
    /** The user's chosen search provider; resolved by `resolveSearchRoute`. */
    searchSettings?: Partial<import('@/lib/search/resolve').SearchSettings> | null;
    /** Already resolved by the client — project beats global. */
    deckTheme?: import('@/lib/themes/resolve').ResolvedTheme | null;
    /**
     * Optional LOWER bound on the surface's turn ceiling. Clamped with
     * `Math.min` — a caller can bound a run, never exceed the surface's policy.
     */
    maxTurns?: number | null;
    /**
     * Hard USD ceiling for the turn, enforced by the SDK mid-run. No surface
     * default to clamp against — absent means the SDK's own default (no cap).
     */
    maxBudgetUsd?: number | null;
    /**
     * Extra tools to withhold from this run, ADDED to whatever the surface and
     * the security toggles already withhold. One-way on purpose: a caller can
     * take a capability away, never grant one back — same direction as the
     * `maxTurns` clamp, and for the same reason.
     *
     * The A/B control arm of the craft eval is what this exists for: measuring
     * whether the craft skills change the output needs a run where they
     * demonstrably cannot load. Doing that by trimming `allowedTools` would
     * withhold nothing at all — that list is an auto-approve list, and the
     * surface runs `permissionMode` high enough that the tool stays usable.
     */
    denyTools?: string[] | null;
    toolProfile?: string;
    onboardingComplete?: boolean;
    capability?: import('@/lib/models/types').Capability | null;
    tier?: import('@/lib/models/types').Tier | null;
    providerConfig?: import('@/lib/models/execution').ProviderExecConfig | null;
    /**
     * Will the caller ACT on the relay events this stream emits — `input_request`,
     * `connector_request`, `document_print`?
     *
     * Every one of those is a request for something only a live client can do, and
     * the provider decides whether it can ask a human purely by whether the
     * matching callback exists. Handing over callbacks for a stream nobody is
     * acting on is how the "no connected client" fallbacks became unreachable: a
     * webhook-triggered DocumentCreate stalled for the full print budget and then
     * reported a rendering failure that never happened.
     *
     * Only the caller knows, so the caller says. Defaults to TRUE because an
     * absent value means an ordinary renderer (or an older one) — those do relay,
     * and silently withholding the callbacks from them would break the connector
     * card, the approval gate and PDF export at once. The server-side callers that
     * cannot relay pass false; `/api/subagent` and the standing-order runner never
     * pass these callbacks at all, which is why the fallbacks already work there.
     */
    canRelayToClient?: boolean;
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

      /**
       * A client that has gone away must stop the agent.
       *
       * Nothing used to connect the two. The client's watchdogs abort a `fetch`,
       * which tears down the HTTP response and nothing else — the SDK subprocess
       * on this side kept running to completion, spending tokens on a stream
       * with no reader and writing files no `tool_use` event would ever announce.
       * That is not a leak in the abstract: an 18-slide deck was finished half a
       * minute after the user had been told the agent was stuck.
       *
       * `POST /api/abort` was built for exactly this, complete with tests, and no
       * client ever called it. The signal is the better hook anyway — it fires
       * when the browser crashes or the machine sleeps, which no explicit call
       * survives. `timeout-ordering.test.ts` asserts this listener still exists.
       */
      req.signal.addEventListener('abort', () => {
        console.warn('[CHAT] Client disconnected — aborting query for', chatId);
        try {
          provider.abort(chatId as string, surfaceId);
        } catch (e) {
          console.error('[CHAT] Abort on client disconnect failed:', e);
        }
      });

      // ── Every independent read, started at once ────────────────────────
      // Nine serialized filesystem round-trips used to sit between the request
      // arriving and the query being assembled: connector health, then SOUL.md,
      // USER.md, IDENTITY.md, VOICE.md, BOOTSTRAP.md, ~/.claude/MEMORY.md and
      // today's memory log — each waiting on the one before it for no reason,
      // since none of them feeds any of the others. Measured at 8 reads with a
      // maximum concurrency of 1.
      //
      // Kicked off here, ahead of the connector load, and awaited at the two
      // points of use. Awaiting one promise twice is free; what matters is that
      // the syscalls are already in flight.
      const { join: pathJoin } = await import('path');
      const { homedir } = await import('os');
      const { staleConnectorIds } = await import('@/lib/connectors/health');
      const home = homedir();
      const contextFiles = Promise.all([
        // Expired-with-no-refresh connections are mounted but will 401, so the
        // agent must be told not to use them (P3.4). Reads the config and the
        // credential store rather than the mounted server map, because
        // loadProvisionedMcpServers strips _meta and `expiresAt` never arrived.
        //
        // Caught rather than allowed to reject: a health read that fails is a
        // reason to stop advertising staleness, not to fail the user's message.
        // It also has to be caught because this promise is created before it is
        // awaited, and an unhandled rejection would take the process with it.
        staleConnectorIds().catch((err: unknown) => {
          console.warn('[CHAT] Connector health unavailable:', err);
          return new Set<string>();
        }),
        readIdentityFile(pathJoin(home, '.claude', 'SOUL.md')),
        readIdentityFile(pathJoin(home, '.claude', 'USER.md')),
        cwd ? readIdentityFile(pathJoin(cwd as string, 'IDENTITY.md')) : Promise.resolve(''),
        readIdentityFile(pathJoin(home, '.claude', 'VOICE.md')),
        onboardingComplete
          ? Promise.resolve('')
          : readIdentityFile(pathJoin(home, '.claude', 'BOOTSTRAP.md')),
        readGlobalMemoryFile(),
        readDailyMemoryLog(),
      ] as const);

      // Build MCP servers config from provisioned OAuth connectors in ~/.claude/.mcp.json
      //
      // The Connectors screen's toggle is honoured UPSTREAM of here (P3.5): switching
      // a connector off calls `/api/connectors/provision?intent=disable`, which moves
      // the entry into `config.disabledMcpServers`, and this loader reads only
      // `config.mcpServers`. So a disabled connector is already absent.
      //
      // There used to be a second mechanism as well — a `disabledConnectors` deny
      // list on the request body, applied by `filterMcpServers` right here. It gave
      // the same answer at strictly worse cost, because it ran AFTER the load:
      // measured at 3 extra AES-256-GCM credential decrypts, one outbound OAuth
      // token-refresh POST and one config rewrite per message, all for a server
      // whose next act was to be discarded. Two representations of one fact is also
      // how they come to disagree. Removed; the stash is the mechanism.
      const mcpServers = await loadProvisionedMcpServers();
      if (Object.keys(mcpServers).length > 0) {
        console.log('[CHAT] Loaded provisioned connector servers:', Object.keys(mcpServers).join(', '));
      }

      // Get surface-specific config
      const surfaceConfig = getSurfaceConfig(surfaceId);

      /**
       * Tools withheld from this run, sent to the provider as `deniedTools`.
       *
       * Every narrowing below used to only shrink `surfaceConfig.allowedTools`,
       * which is the SDK's AUTO-APPROVE list, not the set of mounted tools. With
       * `permissionMode: 'bypassPermissions'` and a `canUseTool` that allows
       * anything it does not recognise, removing a name from it changed nothing
       * at all: "Disable Bash tool" filtered `Bash` out of an approve-list on a
       * run where approval was already skipped, and Bash kept working.
       *
       * So each step now records what it took away. It must be a difference, not
       * the complement of `allowedTools` — the surface lists have never been
       * exhaustive (`WidgetCreate` is on none of them and works everywhere), so
       * treating "absent" as "denied" would break tools nobody asked to remove.
       */
      const deniedTools = new Set<string>();

      /**
       * Caller-requested denials, seeded before any surface narrowing so they
       * survive it. Additive and one-way — nothing downstream removes from this
       * set, so a caller cannot use it to grant itself a tool.
       */
      if (Array.isArray(requestedDenyTools)) {
        for (const t of requestedDenyTools) {
          if (typeof t === 'string' && t.trim()) deniedTools.add(t.trim());
        }
      }

      /** Narrow `allowedTools`, remembering the difference as a real denial. */
      const withhold = (keep: (t: string) => boolean) => {
        if (!surfaceConfig.allowedTools) return;
        // One pass, partitioning: the predicate ran twice per tool before, and a
        // reader had to prove it was pure to trust that the two lists were
        // complements.
        const kept: string[] = [];
        for (const t of surfaceConfig.allowedTools) {
          if (keep(t)) kept.push(t);
          else deniedTools.add(t);
        }
        surfaceConfig.allowedTools = kept;
      };
      /** Profile membership, tolerant of the bare/prefixed split in the configs. */
      const inList = (list: string[], t: string) =>
        list.includes(t) || list.includes(baseToolName(t)) || list.some((x) => baseToolName(x) === t);

      // ── Tool profile filtering ─────────────────────────────────────────
      // Apply tool profile to intersect surface allowedTools with profile set
      if (toolProfile && toolProfile !== 'full' && surfaceConfig.allowedTools) {
        const profileTools = TOOL_PROFILES[toolProfile as keyof typeof TOOL_PROFILES];
        if (profileTools && profileTools.length > 0) {
          // Always keep AskUserQuestion and Agent regardless of profile
          withhold((t) => toolMatches(t, PLUMBING_TOOLS) || inList(profileTools, t));
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
              withhold((t) => toolMatches(t, PLUMBING_TOOLS) || inList(matched.allowedTools as string[], t));
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

      // ── Connected services (P3.3) ─────────────────────────────────────
      // Tell the agent what is connected and what it may offer to connect.
      // Without this it cannot know Gmail is one click away, so the best it can
      // do when asked to send mail is apologise.
      {
        const { classifyCatalog } = await import('@/lib/connectors/connectability');
        const { CONNECTOR_REGISTRY } = await import('@/lib/connectors/registry');
        const { buildConnectorsPrompt, connectedIdsFromServerKeys } = await import(
          '@/lib/connectors/prompt'
        );
        const canRequest =
          surfaceConfig.allowedTools?.includes('mcp__aime__RequestConnector') ?? false;
        // Already in flight since before the connectors were loaded.
        const [staleIds] = await contextFiles;
        const connectorsPrompt = buildConnectorsPrompt(
          classifyCatalog(CONNECTOR_REGISTRY),
          // The ENTRIES, not just the keys: a key like `aime-mcp-github` is a name
          // the user's URL derived, not proof of who answered, so the id is only
          // recovered for an entry whose stored url is on that connector's own
          // origin. Passing keys alone leaves that unprovable and fails closed.
          connectedIdsFromServerKeys(mcpServers),
          { canRequest, staleIds },
        );
        if (connectorsPrompt) {
          surfaceConfig.systemPrompt = `${
            typeof surfaceConfig.systemPrompt === 'string'
              ? surfaceConfig.systemPrompt
              : JSON.stringify(surfaceConfig.systemPrompt)
          }\n\n${connectorsPrompt}`;
        }
      }

      // ── Security settings ──────────────────────────────────────────────
      // Filter Bash from allowedTools if disabled
      // `disableBashTool` is applied by the provider from the stored setting (it
      // withholds the whole shell family), so nothing is done here. The prompt
      // rules below are still assembled from the request body, because they are
      // guidance rather than enforcement and cost nothing if a caller omits them.

      // Build security rules block for system prompt
      const securityRules: string[] = [];
      if (securitySettings?.blockDangerousCommands) {
        // Matches what actually happens now: the command is shown to the user
        // for approval rather than refused outright (see canUseTool). Telling the
        // model to refuse outright as well would have it decline work the user is
        // about to be asked about and would happily approve.
        securityRules.push(
          '- Destructive shell commands (rm -rf, sudo, mkfs, dd, chmod 777, writes into /etc, /usr, /boot) are shown to the user for approval before they run. Do not avoid them when they are genuinely the right step — run them and expect to be asked. Do prefer a narrower command where one does the job, and never use one to work around a refusal.'
        );
      }
      if (securitySettings?.blockNetworkCommands) {
        // Same shape as the line above, and for the same reason: the gate ASKS,
        // so telling the model to refuse outright would have it decline work the
        // user is about to be shown a card for and would approve.
        securityRules.push(
          '- Commands that reach off this machine (nc/netcat, socat, SSH tunnels and port forwards, curl uploads, scp/rsync to a remote host, piping a download into an interpreter) are shown to the user for approval before they run. Package managers and ordinary git remotes — npm install, pip install, git push/pull, brew — are unaffected. Do not avoid a network command that is genuinely the right step; run it and expect to be asked, and never use one to work around a refusal.'
        );
      }
      if (securitySettings?.restrictToProjectFolder && cwd) {
        securityRules.push(
          `- ONLY write or delete files within the project folder: ${cwd}. Reading outside it is allowed. The file tools enforce this and will refuse a path outside it (scratch and temp directories excepted), so do not try to route around a refusal — say what you need to put where and let the user decide.`
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

      // ── Identity/persona and memory files ──────────────────────────────
      // Read as one concurrent batch at the top of this handler; by here they are
      // long since resolved.
      const [, soulMd, userMd, identityMd, voiceMd, bootstrapMd, globalMemoryMd, dailyMemoryLog] =
        await contextFiles;

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
      // The user's own writing voice (P4). Sits with the other "who the user is"
      // material, and is explicitly scoped to prose they will put their name to.
      if (voiceMd) {
        const { parseVoiceProfile, buildVoicePrompt } = await import('@/lib/identity/voice');
        const voicePrompt = buildVoicePrompt(parseVoiceProfile(voiceMd));
        if (voicePrompt) {
          systemPrompt = appendToSystemPrompt(systemPrompt, voicePrompt);
        }
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

      // ── Client-relay callbacks ─────────────────────────────────────────
      // Each of these asks the client to do something the server cannot, and then
      // BLOCKS the agent's turn waiting for the answer. Withheld entirely when the
      // caller has told us nothing is acting on this stream: the provider treats a
      // missing callback as "there is no way to ask", which is the honest answer
      // and the one every fallback is written for. Handing them over regardless is
      // what made those fallbacks unreachable on the HTTP path.
      if (!canRelayToClient) {
        console.log('[CHAT] Caller cannot relay to a client — question/connector/print fallbacks apply');
      }

      // Forward AskUserQuestion to the client.
      const onInputRequest = !canRelayToClient
        ? undefined
        : async (toolUseId: string, questions: unknown) => {
            await sse.writeEvent({
              type: 'input_request',
              toolUseId,
              questions,
            });
          };

      // Forward a connector request to the client (P3.3). The agent is paused
      // in canUseTool while this card is outstanding; the heartbeat keeps the
      // stream open until the user answers.
      const onConnectorRequest = !canRelayToClient
        ? undefined
        : async (toolUseId: string, connectorId: string, reason: string) => {
            await sse.writeEvent({
              type: 'connector_request',
              toolUseId,
              connectorId,
              reason,
            });
          };

      // Relay a document print to the client, which owns the Electron bridge
      // (P4.2b). The server cannot call ipcMain from its child process. Carries
      // the path the tool already wrote, not the markup — see onDocumentPrint.
      const onDocumentPrint = !canRelayToClient
        ? undefined
        : async (
            toolUseId: string,
            payload: { htmlPath: string; outputPath: string; printOptions: Record<string, unknown> },
          ) => {
            await sse.writeEvent({ type: 'document_print', toolUseId, ...payload });
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
        // Every stored field, not just the key: Bedrock and Vertex are driven by
        // environment built from region/project/credentials.
        loadFields: async (id) => {
          try {
            const { getCredentialStore } = await import('@/lib/models/credentials');
            return await getCredentialStore().get(id);
          } catch {
            return undefined;
          }
        },
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
      /** Real numbers from the provider, when it reports them. See below. */
      let reported: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadInputTokens?: number;
        cacheCreationInputTokens?: number;
        totalCostUsd?: number;
      } | null = null;
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
          deniedTools: [...deniedTools],
          searchSettings: searchSettings ?? undefined,
          deckTheme: deckTheme ?? undefined,
          // Deliberately NOT forwarded from the request body: the provider loads
          // the user's toggles itself, so every caller is covered rather than
          // just the two surfaces that remembered to send them — and so omitting
          // the field cannot switch a protection off. See lib/security/settings.
          /**
           * A caller may LOWER the turn ceiling, never raise it.
           *
           * `Math.min` rather than `??` on purpose: the surface's value is a
           * policy, and a request that could raise it would let any caller opt
           * out of that policy. Lowering is safe and is what a bounded run — an
           * eval, a scheduled job, anything with a budget — actually needs.
           *
           * Motivating case: one eval sample ran 124 tool calls over 66 minutes
           * and cost $6.58, entirely within the surface's 200-turn budget. The
           * ceiling existed; there was just no way for the caller to ask for a
           * smaller one.
           */
          maxTurns:
            typeof requestedMaxTurns === 'number' && requestedMaxTurns > 0
              ? Math.min(requestedMaxTurns, surfaceConfig.maxTurns ?? requestedMaxTurns)
              : surfaceConfig.maxTurns,
          ...(typeof requestedBudgetUsd === 'number' && requestedBudgetUsd > 0
            ? { maxBudgetUsd: requestedBudgetUsd }
            : {}),
          systemPrompt,
          attachments: attachments || undefined,
          webSearch: webSearch || undefined,
          apiKey: exec.apiKey,
          baseUrl: exec.baseUrl,
          providerEnv: exec.env,
          cwd: (cwd as string) || undefined,
          history: history || undefined,
          sessionControls: sessionControls || undefined,
          onInputRequest,
          onBrowserToolUse,
          onConnectorRequest,
          onDocumentPrint,
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
          // The turn's real usage, forwarded by the provider from the SDK's
          // terminal result message. Captured rather than relayed: the client
          // reads usage off the `done` event, and two sources for one number is
          // how they drift apart.
          if (chunk.type === 'usage') {
            reported = {
              inputTokens: chunk.inputTokens as number | undefined,
              outputTokens: chunk.outputTokens as number | undefined,
              cacheReadInputTokens: chunk.cacheReadInputTokens as number | undefined,
              cacheCreationInputTokens: chunk.cacheCreationInputTokens as number | undefined,
              totalCostUsd: chunk.totalCostUsd as number | undefined,
            };
            continue;
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

      /**
       * Usage: the provider's REPORTED numbers when it has them, an estimate
       * only as a fallback.
       *
       * Both halves of the old estimate were wrong in ways that mattered.
       * Tokens came from `characters / 4`, which ignores cache reads entirely —
       * and on a long agent turn most input IS a cache read, billed at a tenth.
       * Price came from a hardcoded table that had drifted a model generation:
       * anything matching `opus` was charged at $0.015/$0.075 per 1k, while
       * Opus 5 is $0.005/$0.025 — overstating every Opus run threefold.
       *
       * ROI telemetry is the thing this app offers that the reference tools do
       * not, so a number people act on should come from the API rather than from
       * arithmetic that silently rots as prices change.
       */
      const durationMs = Date.now() - streamStartMs;
      const modelName = effectiveModel || 'claude-sonnet-4-6';
      const estimated = !reported?.totalCostUsd;
      const inputTokens =
        reported?.inputTokens !== undefined
          ? reported.inputTokens + (reported.cacheReadInputTokens ?? 0) + (reported.cacheCreationInputTokens ?? 0)
          : Math.round(inputChars / 4);
      const outputTokens = reported?.outputTokens ?? Math.round(outputChars / 4);
      const { estimateCostUsd } = await import('@/lib/models/pricing');
      const cost = reported?.totalCostUsd ?? estimateCostUsd(modelName, inputTokens, outputTokens);

      await sse.writeEvent({
        type: 'done',
        usage: {
          inputTokens,
          outputTokens,
          cost: Math.round(cost * 10000) / 10000,
          model: modelName,
          durationMs,
          toolCallCount,
          // Says whether the number above can be trusted. A cost that might be
          // an estimate and might not, with no way to tell, is worse than either.
          estimated,
          ...(reported?.cacheReadInputTokens !== undefined
            ? { cacheReadInputTokens: reported.cacheReadInputTokens }
            : {}),
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
