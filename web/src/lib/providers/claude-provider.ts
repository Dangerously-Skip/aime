import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { BaseProvider, type QueryParams, type StreamChunk, type ProviderConfig } from './base-provider';
import { getSurfaceConfig } from '../surfaces';
import { getBedrockEnv, isBedrockConfigured } from '../bedrock-env';
import { getGatewayEnv, isGatewayConfigured, mapModelForGateway } from '../gateway-env';
import { getClaudeSDKPath } from './sdk-path';
import { waitForAnswer } from '../pending-questions';
import { BROWSER_TOOL_NAMES } from '../browser-tools';
import { waitForBrowserToolResult } from '../pending-browser-tools';

/** Canvas tool name — intercepted to push A2UI documents to client. */
const CANVAS_TOOL_NAME = 'canvas';
/** Spawn-agent tool name — intercepted to fire a sub-agent HTTP request. */
const SPAWN_AGENT_TOOL_NAME = 'spawn_agent';

/**
 * Cached system:init data from the most recent session.
 */
export interface SystemInitData {
  skills?: unknown[];
  plugins?: unknown[];
  mcp_servers?: unknown[];
  slash_commands?: unknown[];
  agents?: unknown[];
  [key: string]: unknown;
}

/**
 * Claude Agent SDK provider implementation.
 * Matches the exact behavior from the original server.js.
 */
export class ClaudeProvider extends BaseProvider {
  private defaultAllowedTools: string[];
  private defaultMaxTurns: number;
  private permissionMode: string;
  private abortControllers: Map<string, AbortController>;
  public lastInitData: SystemInitData | null = null;
  /** Recent tool calls per session for loop detection: key → [{name, inputHash}] */
  private toolCallWindows: Map<string, Array<{ name: string; inputHash: string }>> = new Map();

  constructor(config: ProviderConfig = {}) {
    super(config);
    this.defaultAllowedTools = config.allowedTools || [
      'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep',
      'WebFetch', 'TodoWrite', 'Skill',
    ];
    this.defaultMaxTurns = config.maxTurns || 20;
    this.permissionMode = config.permissionMode || 'bypassPermissions';
    this.abortControllers = new Map();
  }

  get name(): string {
    return 'claude';
  }

  /**
   * Scan ~/.claude/plugins/ for local plugin directories.
   */
  private async scanPlugins(): Promise<string[]> {
    try {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const pluginsDir = path.join(os.homedir(), '.claude', 'plugins');
      if (!fs.existsSync(pluginsDir)) return [];
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => path.join(pluginsDir, e.name));
    } catch {
      return [];
    }
  }

  /**
   * Abort an active query for a given chatId (and optional surfaceId).
   */
  abort(chatId: string, surfaceId?: string): boolean {
    const key = this.getAbortKey(chatId, surfaceId);
    const controller = this.abortControllers.get(key);
    if (controller) {
      console.log('[Claude] Aborting query for key:', key);
      controller.abort();
      this.abortControllers.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Execute a query using Claude Agent SDK.
   * Supports optional surface-routed configuration via surfaceId.
   */
  async *query(params: QueryParams): AsyncGenerator<StreamChunk, void, unknown> {
    const {
      prompt,
      chatId,
      surfaceId,
      mcpServers: explicitMcpServers,
      allowedTools: explicitAllowedTools,
      maxTurns: explicitMaxTurns,
      systemPrompt: explicitSystemPrompt,
      model: explicitModel,
      attachments,
      apiKey,
      cwd,
      history,
      onInputRequest,
      onBrowserToolUse,
    } = params;

    // Load surface config if surfaceId is provided, otherwise use defaults
    let surfaceConfig: ReturnType<typeof getSurfaceConfig> | null = null;
    if (surfaceId) {
      try {
        surfaceConfig = getSurfaceConfig(surfaceId);
        console.log('[Claude] Loaded surface config for:', surfaceId);
      } catch {
        console.warn('[Claude] Unknown surface:', surfaceId, '- using defaults');
      }
    }

    // Merge: explicit params > surface config > constructor defaults
    const allowedTools = explicitAllowedTools
      || surfaceConfig?.allowedTools
      || this.defaultAllowedTools;
    const maxTurns = explicitMaxTurns
      ?? surfaceConfig?.maxTurns
      ?? this.defaultMaxTurns;
    const mcpServers = explicitMcpServers
      || surfaceConfig?.mcpServers
      || {};
    const systemPrompt = explicitSystemPrompt
      || surfaceConfig?.systemPrompt
      || undefined;
    const model = explicitModel
      || surfaceConfig?.model
      || undefined;
    const permissionMode = surfaceConfig?.permissionMode
      || this.permissionMode;

    // Scan for installed plugins to pass to SDK
    const pluginPaths = await this.scanPlugins();

    // Per-request array to collect cron jobs created via the CronCreate MCP tool
    const pendingCronJobs: Array<{ expression: string; prompt: string; surfaceId: string }> = [];

    // Per-request array to collect standing orders created via StandingOrderCreate
    const pendingStandingOrders: Array<{
      instruction: string;
      trigger_type: string;
      expression?: string;
      condition?: string;
      completionCondition?: string;
      agentName?: string;
      notifyVia?: string;
      maxExecutions?: number;
      expiresInHours?: number;
    }> = [];

    // In-process MCP server exposing CronCreate so the model can schedule reminders
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const z = (await import('zod/v3') as any).z ?? (await import('zod/v3') as any).default ?? await import('zod/v3');
    const quarryMcpServer = createSdkMcpServer({
      name: 'quarry',
      version: '1.0.0',
      tools: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'CronCreate',
          'Schedule a recurring reminder or task using a cron expression. Use this whenever the user asks to be reminded about something at a future time or on a recurring schedule. Do NOT use Bash crontab commands.',
          {
            expression: z.string().describe('5-field cron expression (min hour dom month dow). E.g. "32 9 * * *" for 9:32am daily, "*/10 * * * *" for every 10 minutes.'),
            prompt: z.string().describe('The reminder message or task to run when the cron fires'),
            surfaceId: z.string().optional().describe('Surface to run on: cowork (default), chat, or code'),
          },
          async ({ expression, prompt, surfaceId }: { expression: string; prompt: string; surfaceId?: string }) => {
            if (expression && prompt) {
              pendingCronJobs.push({ expression, prompt, surfaceId: surfaceId ?? 'cowork' });
            }
            return {
              content: [{ type: 'text' as const, text: `Reminder scheduled: "${prompt}" (${expression}). It will appear in Customize → Automation → Cron Jobs.` }],
            };
          }
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'StandingOrderCreate',
          'Create a standing order — a persistent, stateful instruction that runs on a schedule or interval. Use this for reminders, monitoring, recurring tasks, and any "watch for X and do Y" requests. Preferred over CronCreate for new orders.',
          {
            instruction: z.string().describe('What to do when this order fires — the task or prompt to execute'),
            trigger_type: z.enum(['cron', 'interval']).describe('When to trigger: "cron" for specific times (cron expression), "interval" for recurring delays like "5m" or "1h"'),
            expression: z.string().describe('Trigger expression: 5-field cron (e.g. "0 9 * * 1-5") or interval (e.g. "5m", "2h", "1d")'),
            condition: z.string().optional().describe('Only act when this condition is true (natural language)'),
            completionCondition: z.string().optional().describe('Auto-complete the order when this condition is met'),
            agentName: z.string().optional().describe('Agent from AGENTS.md to execute the order'),
            notifyVia: z.enum(['assistant', 'toast']).optional().describe('How to notify: "assistant" shows in card feed (default), "toast" shows desktop notification'),
            maxExecutions: z.number().optional().describe('Maximum number of times to run before auto-completing'),
            expiresInHours: z.number().optional().describe('Auto-expire after this many hours'),
          },
          async (input: { instruction: string; trigger_type: string; expression: string; condition?: string; completionCondition?: string; agentName?: string; notifyVia?: string; maxExecutions?: number; expiresInHours?: number }) => {
            pendingStandingOrders.push(input);
            const triggerDesc = input.trigger_type === 'cron' ? `cron: ${input.expression}` : `every ${input.expression}`;
            return {
              content: [{ type: 'text' as const, text: `Standing order created: "${input.instruction}" (${triggerDesc}). It will appear in the Assistant surface sidebar and fire automatically.` }],
            };
          }
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'ExcelRead',
          'Read data from an Excel spreadsheet (.xlsx/.xls). Returns the contents as a markdown table. Use this to inspect spreadsheet data.',
          {
            file_path: z.string().describe('Absolute path to the Excel file'),
            sheet: z.string().optional().describe('Sheet name to read (defaults to first sheet)'),
            range: z.string().optional().describe('Cell range to read, e.g. "A1:D10" (defaults to entire sheet)'),
          },
          async ({ file_path, sheet, range }: { file_path: string; sheet?: string; range?: string }) => {
            const { readExcel } = await import('../extractors/xlsx');
            const result = await readExcel(file_path, sheet, range);
            return { content: [{ type: 'text' as const, text: result }] };
          }
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'ExcelWrite',
          'Create a new Excel spreadsheet (.xlsx) with the given data. Each sheet has a name and a 2D array of cell values (first row is headers).',
          {
            file_path: z.string().describe('Absolute path for the new Excel file'),
            sheets: z.array(z.object({
              name: z.string().describe('Sheet name'),
              data: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('2D array of cell values (first row = headers)'),
            })).describe('Array of sheets to create'),
          },
          async ({ file_path, sheets }: { file_path: string; sheets: Array<{ name: string; data: unknown[][] }> }) => {
            const { writeExcel } = await import('../extractors/xlsx');
            const result = await writeExcel(file_path, sheets);
            return { content: [{ type: 'text' as const, text: result }] };
          }
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'ExcelEdit',
          'Edit cells in an existing Excel spreadsheet (.xlsx/.xls). Specify the sheet name and an array of cell edits.',
          {
            file_path: z.string().describe('Absolute path to the Excel file to edit'),
            sheet: z.string().describe('Sheet name to edit'),
            edits: z.array(z.object({
              cell: z.string().describe('Cell reference, e.g. "A1", "B5"'),
              value: z.union([z.string(), z.number(), z.boolean()]).describe('New cell value'),
            })).describe('Array of cell edits to apply'),
          },
          async ({ file_path, sheet, edits }: { file_path: string; sheet: string; edits: Array<{ cell: string; value: string | number | boolean }> }) => {
            const { editExcel } = await import('../extractors/xlsx');
            const result = await editExcel(file_path, sheet, edits);
            return { content: [{ type: 'text' as const, text: result }] };
          }
        ),
      ],
    });

    // Build query options
    const queryOptions: Record<string, unknown> = {
      allowedTools,
      disallowedTools: ['WebSearch'],
      maxTurns,
      mcpServers: {
        ...mcpServers,
        quarry: quarryMcpServer,
        'nib-web-search': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@jharding_npm/mcp-server-searxng'],
          env: {
            SEARXNG_INSTANCES: process.env.SEARXNG_INSTANCES || 'https://ai-studio-searxng.internal.invalid',
          },
        },
      },
      permissionMode,
      settingSources: ['user', 'project'], // Enable Skills from filesystem
      ...(pluginPaths.length > 0 && {
        plugins: pluginPaths.map(p => ({ type: 'local', path: p })),
      }),
    };

    // In packaged Electron builds, the SDK can't find its CLI binary via import.meta.url
    // because the bundler minifies module paths. The instrumentation hook sets globalThis
    // from the QUARRY_SDK_CLI_PATH env var passed by the Electron main process.
    // Also set executable to the current Node process so the SDK doesn't try to find
    // 'node' in PATH (which doesn't exist in packaged Electron apps).
    const sdkCliPath = (globalThis as Record<string, unknown>).__quarryClaudeSDKPath as string | undefined;
    if (sdkCliPath) {
      queryOptions.pathToClaudeCodeExecutable = sdkCliPath;
    }

    // Loop detection window for this query
    const loopWindow: Array<{ name: string; inputHash: string }> = [];
    const LOOP_WARN_THRESHOLD = 3;
    const LOOP_DENY_THRESHOLD = 5;

    // Write tools that require approval in background/scheduled execution contexts
    const GOVERNED_WRITE_TOOLS = new Set([
      'Write', 'Edit', 'NotebookEdit',
      'gmail_send', 'gmail_create_draft',
      'slack_post', 'slack_send',
      'jira_create', 'jira_update',
      'confluence_create', 'confluence_update',
    ]);

    // Detect if this is a background/scheduled execution (not interactive)
    const isBackgroundRun = chatId.startsWith('standing-order-') || chatId.startsWith('subagent_') || chatId.startsWith('hb-');

    // Intercept AskUserQuestion, browser tools, canvas tool, and loop detection via canUseTool.
    queryOptions.canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      { toolUseID }: { toolUseID: string },
    ) => {
      // ── Governance: deny write tools in background runs ─────────────────
      if (isBackgroundRun) {
        // Check if the tool name matches any governed write tool (handle MCP prefixes)
        const baseName = toolName.includes('__') ? toolName.split('__').pop()! : toolName.includes(':') ? toolName.split(':').pop()! : toolName;
        if (GOVERNED_WRITE_TOOLS.has(baseName)) {
          console.warn('[Governance] Denied write tool in background run:', toolName, 'chatId:', chatId);
          return {
            behavior: 'deny' as const,
            message: `This tool (${baseName}) requires user approval for background/scheduled execution. An approval card has been created in the Assistant surface. The user can approve and re-run.`,
          };
        }
      }
      // ── Loop detection ─────────────────────────────────────────────────
      const inputHash = JSON.stringify(input);
      loopWindow.push({ name: toolName, inputHash });
      // Keep last 10 tool calls
      if (loopWindow.length > 10) loopWindow.shift();
      // Count consecutive identical calls
      let consecutiveCount = 0;
      for (let i = loopWindow.length - 1; i >= 0; i--) {
        if (loopWindow[i].name === toolName && loopWindow[i].inputHash === inputHash) {
          consecutiveCount++;
        } else {
          break;
        }
      }
      // Hard deny after 5 consecutive identical calls
      if (consecutiveCount >= LOOP_DENY_THRESHOLD) {
        console.error('[Claude] Loop DENIED for tool:', toolName, 'id:', toolUseID, `(${consecutiveCount} consecutive identical calls)`);
        return {
          behavior: 'deny' as const,
          message: `Tool call denied — you've called ${toolName} ${consecutiveCount} times with identical inputs. This is a loop. Stop and tell the user what went wrong and suggest an alternative approach.`,
        };
      }
      // Warn after 3 consecutive identical calls
      if (consecutiveCount >= LOOP_WARN_THRESHOLD) {
        console.warn('[Claude] Loop warning for tool:', toolName, 'id:', toolUseID, `(${consecutiveCount} consecutive identical calls)`);
        return {
          behavior: 'allow' as const,
          updatedInput: {
            ...input,
            __loopDetected: true,
            __loopMessage: `Loop detected — you've called ${toolName} ${consecutiveCount} times with identical inputs. Try a different approach or call a different tool. After ${LOOP_DENY_THRESHOLD} identical calls the tool will be blocked.`,
          },
        };
      }

      // ── CronCreate (in-process MCP or direct) ─────────────────────────
      if (toolName === 'CronCreate' || toolName.endsWith('__CronCreate') || toolName.endsWith(':CronCreate')) {
        const expression = input.expression as string;
        const prompt = input.prompt as string;
        if (expression && prompt) {
          const alreadyQueued = pendingCronJobs.some(
            (j) => j.expression === expression && j.prompt === prompt
          );
          if (!alreadyQueued) {
            pendingCronJobs.push({ expression, prompt, surfaceId: (input.surfaceId as string) ?? surfaceId ?? 'cowork' });
            console.log('[Claude] CronCreate intercepted in canUseTool:', expression, prompt);
          }
        }
        return { behavior: 'allow' as const };
      }

      // ── AskUserQuestion ────────────────────────────────────────────────
      if (toolName === 'AskUserQuestion' && onInputRequest) {
        await onInputRequest(toolUseID, input.questions);
        const answers = await waitForAnswer(toolUseID);
        return {
          behavior: 'allow' as const,
          updatedInput: { ...input, answers },
        };
      }

      // ── Spawn agent ────────────────────────────────────────────────────
      if (toolName === SPAWN_AGENT_TOOL_NAME) {
        const task = typeof input.task === 'string' ? input.task : JSON.stringify(input);
        const subSurfaceId = typeof input.surfaceId === 'string' ? input.surfaceId : (surfaceId ?? 'cowork');
        const subModel = typeof input.model === 'string' ? input.model : null;
        console.log('[Claude] Intercepting spawn_agent — task:', task.slice(0, 80));
        try {
          const res = await fetch('http://localhost:3000/api/subagent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parentChatId: chatId, task, surfaceId: subSurfaceId, model: subModel, cwd, apiKey: apiKey || undefined }),
          });
          const data = await res.json() as { ok?: boolean; output?: string; error?: string };
          const subOutput = data.ok ? (data.output ?? '') : `Sub-agent error: ${data.error}`;
          return {
            behavior: 'allow' as const,
            updatedInput: { ...input, __spawn_agent_output: subOutput },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            behavior: 'allow' as const,
            updatedInput: { ...input, __spawn_agent_output: `Failed to spawn sub-agent: ${msg}` },
          };
        }
      }

      // ── Browser tools ──────────────────────────────────────────────────
      if (BROWSER_TOOL_NAMES.has(toolName) && onBrowserToolUse) {
        console.log('[Claude] Intercepting browser tool:', toolName, 'id:', toolUseID);
        await onBrowserToolUse(toolUseID, toolName, input);
        const result = await waitForBrowserToolResult(toolUseID);
        return {
          behavior: 'allow' as const,
          updatedInput: { ...input, __browserToolResult: result.output, __isError: result.isError },
        };
      }

      return { behavior: 'allow' as const };
    };

    // Set working directory — use selected folder, or fall back to a safe temp
    // directory so the agent never defaults to the app's own source tree.
    if (cwd) {
      queryOptions.cwd = cwd;
      console.log('[Claude] Working directory set to:', cwd);
    } else {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const safeCwd = path.join(os.tmpdir(), 'quarry-sandbox');
      fs.mkdirSync(safeCwd, { recursive: true });
      queryOptions.cwd = safeCwd;
      console.log('[Claude] No folder selected — using safe temp directory:', safeCwd);
    }

    // Apply system prompt if available
    if (systemPrompt) {
      queryOptions.systemPrompt = systemPrompt;
    }

    // Apply model if available
    if (model) {
      queryOptions.model = model;
    }

    // IMPORTANT: Always strip CLAUDECODE from subprocess env to prevent
    // "nested session" detection when the app is launched from a Claude Code terminal.
    const os = await import('os');
    const path = await import('path');
    const { CLAUDECODE: _cc, ...safeEnv } = process.env;
    queryOptions.env = {
      ...safeEnv,
      CLAUDE_CONFIG_DIR: path.join(os.homedir(), '.quarry'),
    };

    // Gateway env passthrough: if nib Gateway API key is provided, route through gateway
    // This takes priority over Bedrock env
    if (apiKey && isGatewayConfigured(apiKey)) {
      queryOptions.env = {
        ...safeEnv,
        ...(queryOptions.env as Record<string, string> || {}),
        ...getGatewayEnv(apiKey),
        // Gateway LiteLLM doesn't support adaptive thinking — disable it via CLI env var
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
      };
      // Override model to use gateway-compatible short names
      queryOptions.model = mapModelForGateway(model);
      console.log('[Claude] Gateway configured, routing through nib AI Studio');
    } else if (isBedrockConfigured()) {
      queryOptions.env = { ...safeEnv, ...(queryOptions.env as Record<string, string> || {}), ...getBedrockEnv() };
      console.log('[Claude] Bedrock env configured, routing through AWS');
    }

    // Check for existing session - matches server.js session resumption logic
    // Skip resume if the working directory changed (session cwd is baked in)
    const existingSessionId = chatId ? this.getSession(chatId) : null;
    const previousCwd = chatId ? this.getSessionCwd(chatId) : null;
    // Detect cwd change: if cwd is provided and either there was no previous cwd
    // stored or it differs, treat it as a change so we start a fresh session.
    const cwdChanged = cwd ? (!previousCwd || cwd !== previousCwd) : false;
    if (cwdChanged) {
      console.log('[Claude] Working directory changed from', previousCwd || '(none)', 'to', cwd, '- starting fresh session');
    } else {
      console.log('[Claude] Existing session ID for', chatId, ':', existingSessionId || 'none (new chat)');
    }

    // If we have an existing session and cwd hasn't changed, resume it
    if (existingSessionId && !cwdChanged) {
      queryOptions.resume = existingSessionId;
      console.log('[Claude] Resuming session:', existingSessionId);
    }

    // Build prompt — prepend conversation history as XML when no session to resume
    let queryPrompt: unknown = prompt;
    if (!existingSessionId && history?.length) {
      const historyXml = history
        .map((m) => `<msg role="${m.role}">${m.content}</msg>`)
        .join('\n');
      queryPrompt = `<conversation_history>\n${historyXml}\n</conversation_history>\n\n${prompt}`;
      console.log('[Claude] Prepended conversation history (' + history.length + ' messages) as XML fallback');
    }

    // Inline attachment content into prompt string (Agent SDK only accepts string prompts)
    if (attachments && attachments.length > 0) {
      const attachmentTexts: string[] = [];

      for (const att of attachments) {
        if (att.category === 'image') {
          const extractedPath = (att as { extractedPath?: string }).extractedPath;
          if (extractedPath) {
            // Image saved to disk — tell agent to use Read tool (which supports images)
            attachmentTexts.push(`[Attached image: ${att.name}]\nThe image has been saved to: ${extractedPath}\nUse the Read tool to view it.`);
          } else {
            attachmentTexts.push(`[Attached image: ${att.name}]\n(Image content is attached but cannot be displayed in text mode. The user attached an image file.)`);
          }
        } else if ((att as { extractedPath?: string }).extractedPath) {
          // Document was extracted and saved to scratch — tell agent to use Read/Grep
          attachmentTexts.push(`[Attached document: ${att.name}]\nThe full extracted text has been saved to: ${(att as { extractedPath: string }).extractedPath}\nUse the Read tool to access the content. Use Grep to search within it.`);
        } else if (att.category === 'text' || att.category === 'document') {
          // Text or inline-extracted content: wrap in document tags
          if (att.content && att.content.length > 0) {
            attachmentTexts.push(`[File: ${att.name}]\n<document name="${att.name}">\n${att.content}\n</document>`);
          } else {
            attachmentTexts.push(`[File: ${att.name}]\n(File content could not be extracted.)`);
          }
        } else {
          // Other categories with inline content
          if (att.content) {
            attachmentTexts.push(`[File: ${att.name}]\n<document name="${att.name}">\n${att.content}\n</document>`);
          }
        }
      }

      const attachmentContext = attachmentTexts.join('\n\n');
      queryPrompt = `${attachmentContext}\n\n${queryPrompt}`;
      console.log('[Claude] Inlined', attachments.length, 'attachment(s) into prompt');
    }

    console.log('[Claude] Calling Claude Agent SDK...', surfaceId ? `(surface: ${surfaceId})` : '');

    // Create abort controller for this request
    // Use composite key (surfaceId:chatId) for concurrent surface support
    const abortKey = this.getAbortKey(chatId, surfaceId);
    const abortController = new AbortController();
    if (chatId) {
      this.abortControllers.set(abortKey, abortController);
    }

    try {
      // Stream responses from Claude Agent SDK - matches server.js exactly
      for await (const chunk of query({
        prompt: queryPrompt,
        options: queryOptions,
        abortSignal: abortController.signal,
      } as Parameters<typeof query>[0])) {
        const c = chunk as Record<string, unknown>;

        // Debug: log all system messages to find session_id
        if (c.type === 'system') {
          console.log('[Claude] System message:', JSON.stringify(c, null, 2));
        }

        // Capture session ID and system:init data - matches server.js logic
        if (c.type === 'system' && c.subtype === 'init') {
          const newSessionId = (c.session_id || (c.data as Record<string, unknown>)?.session_id || c.sessionId) as string | undefined;
          if (newSessionId && chatId) {
            this.setSession(chatId, newSessionId, cwd);
            console.log('[Claude] Session ID captured:', newSessionId);
            console.log('[Claude] Total sessions stored:', this.sessions.size);
          } else {
            console.log('[Claude] No session_id found in init message');
          }

          // Cache system:init data for introspection
          const initData: SystemInitData = {};
          const data = (c.data || c) as Record<string, unknown>;
          if (data.skills) initData.skills = data.skills as unknown[];
          if (data.plugins) initData.plugins = data.plugins as unknown[];
          if (data.mcp_servers) initData.mcp_servers = data.mcp_servers as unknown[];
          if (data.slash_commands) initData.slash_commands = data.slash_commands as unknown[];
          if (data.agents) initData.agents = data.agents as unknown[];
          this.lastInitData = initData;
          console.log('[Claude] system:init data cached:', Object.keys(initData).join(', '));

          // Yield session init event with system:init data
          if (newSessionId) {
            yield {
              type: 'session_init',
              session_id: newSessionId,
              provider: this.name,
            };
          }

          // Yield system_init event to forward data to client
          yield {
            type: 'system_init',
            ...initData,
            provider: this.name,
          };

          continue;
        }

        // Handle assistant messages - extract text and tool_use blocks
        if (c.type === 'assistant' && c.message) {
          // A new assistant message means any previous turn's tools have finished executing.
          yield { type: 'turn_start', provider: this.name };

          const message = c.message as Record<string, unknown>;
          const content = message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                yield {
                  type: 'text',
                  content: block.text as string,
                  provider: this.name,
                };
              } else if (block.type === 'tool_use') {
                const toolName = block.name as string;
                const toolInput = block.input as Record<string, unknown>;

                // Intercept canvas tool — emit canvas SSE event instead of regular tool_use
                if (toolName === CANVAS_TOOL_NAME) {
                  console.log('[Claude] Canvas tool use — emitting canvas event');
                  yield {
                    type: 'canvas',
                    doc: toolInput,
                    id: block.id as string,
                    provider: this.name,
                  };
                } else if (toolName === 'CronCreate' || toolName.endsWith('__CronCreate') || toolName.endsWith(':CronCreate')) {
                  // Intercept CronCreate (any server prefix) — emit cron_create SSE event
                  console.log('[Claude] CronCreate tool use — emitting cron_create event, toolName:', toolName);
                  yield {
                    type: 'cron_create',
                    input: toolInput,
                    id: block.id as string,
                    provider: this.name,
                  };
                } else {
                  yield {
                    type: 'tool_use',
                    name: toolName,
                    input: toolInput,
                    id: block.id as string,
                    provider: this.name,
                  };
                  console.log('[Claude] Tool use:', toolName);
                }
              }
            }
          }
          continue;
        }

        // Handle tool results — try multiple field names for the tool use ID
        // since different SDK versions may use different conventions
        if (c.type === 'tool_result' || c.type === 'result') {
          const toolUseId = (c.tool_use_id || c.toolUseId || c.id) as string;
          yield {
            type: 'tool_result',
            result: (c.result || c.content || c) as unknown,
            tool_use_id: toolUseId,
            provider: this.name,
          };
          continue;
        }

        // Skip system chunks, pass through others
        if (c.type !== 'system') {
          yield {
            ...(c as StreamChunk),
            provider: this.name,
          };
        }
      }

      // Emit cron_create events for any jobs created via the CronCreate MCP tool
      for (const job of pendingCronJobs) {
        yield {
          type: 'cron_create',
          input: job,
          id: `cron_${Date.now()}`,
          provider: this.name,
        };
      }

      // Emit standing_order_create events for orders created via StandingOrderCreate MCP tool
      for (const order of pendingStandingOrders) {
        yield {
          type: 'standing_order_create',
          input: order,
          id: `so_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          provider: this.name,
        };
      }

      // Signal completion
      yield {
        type: 'done',
        provider: this.name,
      };

      console.log('[Claude] Stream completed');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[Claude] Query aborted for chatId:', chatId);
        yield {
          type: 'aborted',
          provider: this.name,
        };
      } else {
        throw error;
      }
    } finally {
      // Clean up abort controller using composite key
      if (chatId) {
        this.abortControllers.delete(abortKey);
      }
    }
  }
}
