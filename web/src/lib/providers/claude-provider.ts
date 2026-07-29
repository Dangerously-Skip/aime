import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { BaseProvider, type QueryParams, type StreamChunk, type ProviderConfig } from './base-provider';
import { getSurfaceConfig } from '../surfaces';
import { getBedrockEnv, isBedrockConfigured } from '../bedrock-env';
import { waitForAnswer } from '../pending-questions';
import { BROWSER_TOOL_NAMES } from '../browser-tools';
import { waitForBrowserToolResult } from '../pending-browser-tools';
import { waitForConnector } from '../pending-connectors';
import { waitForDocumentPrint } from '../pending-documents';
import { issueHandle } from '../rendezvous';
import { expandCanvasTemplate } from '../canvas/templates';
import {
  SHELL_TOOLS,
  classifyCommand,
  buildCommandApprovalQuestion,
} from '../security/destructive-commands';
import { isFileWriteTool, writeTargetAllowed, writeTargetOf } from '../security/write-scope';
import { toolMatches } from '../security/tool-names';
import { getScratchDir } from '../app-paths';
import { loadSecuritySettings } from '../security/settings';
import { describeThemes as describeThemesForPrompt } from '../documents/themes';
import {
  buildToolGate,
  buildApprovalQuestion,
  readApprovalAnswer,
  readToolDecisions,
  recordToolDecision,
  type ApprovalDecision,
  type ToolDecisions,
  type ToolGate,
} from '../mcp/tool-policy';

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
  /** Tool names the session actually mounted — the input to the tool budget (P3.5). */
  tools?: string[];
  /** Summary of how many tools each MCP server contributed. */
  toolBudget?: import('../mcp/filter').ToolBudgetReport;
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
        // Dot-directories are not plugins. /api/mcp/install stages a clone in
        // `.tmp-<name>-<unique>/` inside this very directory before promoting it,
        // so without this an install that is still cloning gets handed to the SDK
        // as a half-populated plugin.
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
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
      deniedTools,
      securitySettings,
      maxTurns: explicitMaxTurns,
      systemPrompt: explicitSystemPrompt,
      model: explicitModel,
      attachments,
      apiKey,
      baseUrl,
      cwd,
      history,
      sessionControls,
      onInputRequest,
      onBrowserToolUse,
      onConnectorRequest,
      onDocumentPrint,
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
    /**
     * Tools withheld from this run. `allowedTools` cannot do this — it is an
     * auto-approve list, so narrowing it leaves the tool mounted and reachable
     * (see QueryParams). WebSearch has always been here; the caller's list joins
     * it, and everything downstream treats the two the same.
     */
    /**
     * The user's security toggles.
     *
     * Loaded HERE, not taken on trust from the caller, because only two of the
     * nine `provider.query()` call sites ever sent them — so a control the
     * Settings screen badged ENFORCED did nothing on Chat, subagents, cron,
     * webhooks, standing orders or widget refresh, and omitting the field was a
     * way to switch it off. An explicit set still wins (tests supply one); the
     * fallback is what makes every other path safe by construction, including
     * paths written later. See lib/security/settings.ts.
     */
    const security = { ...(await loadSecuritySettings()), ...(securitySettings ?? {}) };

    const denied = new Set<string>([
      'WebSearch',
      ...(deniedTools ?? []),
      // Derived from the user setting rather than left to the route, for the same
      // reason: a caller that assembles its own params cannot forget it.
      ...(security.disableBashTool ? ['Bash', 'BashOutput', 'KillShell'] : []),
    ]);
    /**
     * The directory the run is ACTUALLY rooted at.
     *
     * The write-scope gate used to read `cwd` directly and skip itself entirely
     * when the caller sent none — which is every Chat turn — so the toggle
     * rendered an "enforced" badge and did nothing. The provider already falls
     * back to a per-conversation scratch dir further down (search for
     * `getScratchDir`); the gate now uses the same value, so a run with no folder
     * selected is confined to its scratch space rather than unconfined.
     */
    const effectiveCwd = cwd || (chatId ? getScratchDir(chatId) : undefined);
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
    console.log('[Claude] Plugin paths found:', pluginPaths);

    /**
     * Abort plumbing, created up here rather than beside the query call below,
     * because the in-process tool handlers and `canUseTool` both close over the
     * SIGNAL: every cross-request wait they open is tied to this query's life.
     * Without that, pressing Stop with a connector card open left a live
     * five-minute timer holding a resolve closure nobody would ever call — see
     * rendezvous.ts.
     *
     * Only the CONTROLLER is created here. Registration in `abortControllers`
     * still happens immediately before the query starts, so a failure during
     * setup cannot leave a stale entry for a later abort() to find.
     */
    const abortController = new AbortController();
    /** Every rendezvous this query opens dies with it. */
    const waitOptions = { signal: abortController.signal };

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

    // Widgets requested via the WidgetCreate MCP tool (the chat → Cockpit
    // pin loop, P6/K5). Flow mirrors StandingOrderCreate: queue here, emit as
    // widget_create chunks after the stream, client adds to widget-store.
    const pendingWidgets: Array<{
      title: string;
      recipe: string;
      refreshEvery?: string;
      allowWeb?: boolean;
    }> = [];

    const providerName = this.name;
    /**
     * Signatures of client-effect chunks already sent mid-stream.
     *
     * These tools only QUEUE (an MCP handler cannot yield), so the effect used to
     * ride out in a flush after the stream loop — which the abort path never
     * reached, and which the client is no longer READING once the user presses
     * Stop, because Stop aborts the fetch. Emitting from the `tool_use` block
     * instead gets the chunk out while the reader is still attached; the queue
     * stays as the belt for a server-side abort, and this set stops the two
     * paths emitting the same thing twice.
     */
    const emittedEffects = new Set<string>();
    const effectKey = (type: string, input: unknown) => `${type}:${JSON.stringify(input)}`;
    /**
     * Emit the client-side effects the in-process MCP tools queued, and empty the
     * queues so a second drain yields nothing.
     *
     * Run on the abort path as well as the normal one. These handlers return
     * success to the model the instant they queue, so "pinned to your Cockpit" is
     * already in the transcript by the time the turn ends — and the flush used to
     * sit after the stream loop inside `try`, unreachable once the user pressed
     * Stop or the 90s tool watchdog fired. The user was left holding a promise
     * and no widget, with nothing in the UI to say why.
     *
     * Splices rather than reads, so the normal path and the abort path can both
     * call it without the risk of emitting a job twice.
     */
    function* drainPending(): Generator<StreamChunk> {
      for (const job of pendingCronJobs.splice(0)) {
        yield { type: 'cron_create', input: job, id: `cron_${Date.now()}`, provider: providerName };
      }
      for (const order of pendingStandingOrders.splice(0)) {
        if (emittedEffects.has(effectKey('standing_order_create', order))) continue;
        yield {
          type: 'standing_order_create',
          input: order,
          id: `so_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          provider: providerName,
        };
      }
      // P6/K5, the chat → Cockpit pin loop.
      for (const widget of pendingWidgets.splice(0)) {
        if (emittedEffects.has(effectKey('widget_create', widget))) continue;
        yield {
          type: 'widget_create',
          input: widget,
          id: `wg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          provider: providerName,
        };
      }
    }

    /**
     * RequestConnector calls made during this request, keyed by connector id (P3.3).
     *
     * Keyed by connector id because that is the only thing the handler can look
     * itself up by: the outcome is NOT passed through `updatedInput`, since
     * RequestConnector is an in-process MCP tool and the SDK zod-parses its
     * arguments and STRIPS unknown keys before the handler runs (verified by
     * execution). The `__x` pattern works for AskUserQuestion, spawn_agent and
     * browser tools precisely because those are not MCP tools.
     *
     * It used to be `Map<connectorId, outcome>` with no delete — a last-write-wins
     * slot. The rendezvous one layer down is correctly keyed by tool-use id, but
     * this was not, so two RequestConnector blocks for the SAME connector in one
     * turn crossed in both directions against the real canUseTool: a user who
     * CONNECTED was told "Not connected: user declined", and a user who DECLINED
     * was told "slack is now connected". Two things stop that now:
     *
     *   - `canUseTool` REFUSES a second request for a connector already asked
     *     about this turn. "At most one per turn" was prose in the tool
     *     description and enforced nowhere, while CronCreate three hundred lines
     *     up has had an `alreadyQueued` guard all along.
     *   - the handler CONSUMES the outcome (`reported`), so it belongs to the one
     *     tool call that produced it and cannot be replayed.
     */
    interface ConnectorRequestRecord {
      // No `toolUseId` here: it was written by both call sites and read by
      // nobody, and now that the rendezvous is keyed by a nonce (issueHandle)
      // rather than the SDK's id, a field of that name would actively mislead
      // the next reader into thinking it is what the card echoes back.
      outcome?: { connected: boolean; reason?: string };
      /** Set once the handler has told the model about it. */
      reported?: boolean;
    }
    const connectorRequests = new Map<string, ConnectorRequestRecord>();

    // In-process MCP server exposing CronCreate so the model can schedule reminders
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const z = (await import('zod/v3') as any).z ?? (await import('zod/v3') as any).default ?? await import('zod/v3');
    const aimeMcpServer = createSdkMcpServer({
      name: 'aime',
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
          'WidgetCreate',
          'Pin a live dashboard widget to the user\'s Cockpit. Use when the user asks for a widget, dashboard, tracker, or an "at a glance" view of something. The recipe is re-run on each refresh to regenerate the tile, so describe WHAT to show, not the data itself.',
          {
            title: z.string().describe('Short tile title, e.g. "AAPL price"'),
            recipe: z.string().describe('What the tile should show, as an instruction — e.g. "Top 5 Hacker News stories about AI with their points"'),
            refreshEvery: z.string().optional().describe('Refresh interval like "30m", "2h", "1d". Omit for manual refresh only.'),
            allowWeb: z.boolean().optional().describe('Whether refreshes may search/fetch the web'),
          },
          async (input: { title: string; recipe: string; refreshEvery?: string; allowWeb?: boolean }) => {
            if (input.title && input.recipe) pendingWidgets.push(input);
            return {
              content: [{ type: 'text' as const, text: `Widget "${input.title}" pinned to the Cockpit${input.refreshEvery ? ` (refreshes every ${input.refreshEvery})` : ''}. It will populate on its first refresh.` }],
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'canvas',
          'Render a structured visualisation in the right-side canvas panel. Use for diagrams, charts, kanban boards, schemas, dashboards. Pass either a templated payload `{ templateId, input }` (preferred when a template fits) OR a raw A2UI document `{ version: "1", title, components }`. The visualisation appears immediately in the canvas panel; the user can pin it to a project and interact with action buttons. PREFER this over generating HTML for visualisations.',
          {
            // Permissive schema so both templated and raw forms validate.
            templateId: z.string().optional().describe('Canvas template id (e.g. "architecture", "er_diagram", "jira_kanban"). When set, `input` is the template input; everything else is ignored.'),
            input: z.record(z.string(), z.unknown()).optional().describe('Template input — required when templateId is set. Shape depends on the template.'),
            version: z.string().optional().describe('Raw A2UI doc version, e.g. "1". Only when not using a template.'),
            title: z.string().optional().describe('Raw A2UI doc title.'),
            components: z.array(z.record(z.string(), z.unknown())).optional().describe('Raw A2UI components array.'),
          },
          async (input: Record<string, unknown>) => {
            const label = typeof input.templateId === 'string'
              ? `template "${input.templateId}"`
              : 'raw A2UI document';
            return { content: [{ type: 'text' as const, text: `Canvas rendered (${label}). The user sees it now in the canvas panel.` }] };
          }
        ),
        // Produce a themed document (P4.2). Replaces "pip install fpdf2 and
        // improvise": the model writes markdown, a theme decides how it looks.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          "DocumentCreate",
          "Produce a designed document (PDF) from markdown you write. Use when the user asks for a report, memo, proposal, invoice, brief or any deliverable they will share or print — NOT for a chat answer. Write the content as markdown; a theme handles all typography, spacing and page layout, so do not attempt to style anything yourself and do not write code to generate the file. Themes: " + describeThemesForPrompt(),
          {
            title: z.string().describe("Document title, shown as the heading and used for the filename."),
            markdown: z.string().describe("The document body as markdown. Headings, lists, tables and code all render. Inline HTML is not supported and will be shown as literal text."),
            theme: z.string().optional().describe("One of the theme ids listed above. Defaults to \"report\"."),
            subtitle: z.string().optional().describe("Shown beneath the title — a date, author or reference."),
          },
          async (input: Record<string, unknown>) => {
            try {
              const { renderDocument, printOptionsForTheme } = await import("../documents/render");
              const { resolveDocumentTarget, describeOutcome } = await import("../documents/write");
              const os = await import("os");
              const path = await import("path");
              const fsp = await import("fs/promises");

              const title = typeof input.title === "string" ? input.title : "";
              const baseDir = cwd ? String(cwd) : path.join(os.homedir(), "Documents");
              const resolved = resolveDocumentTarget(baseDir, title);
              if (!resolved.ok) {
                return { content: [{ type: "text" as const, text: `Could not create the document: ${resolved.error}` }] };
              }

              const html = renderDocument({
                title,
                markdown: typeof input.markdown === "string" ? input.markdown : "",
                theme: typeof input.theme === "string" ? input.theme : undefined,
                subtitle: typeof input.subtitle === "string" ? input.subtitle : undefined,
              });

              await fsp.mkdir(resolved.target.dir, { recursive: true });

              // Refuse to clobber. SkillCreate, forty lines below, already refuses
              // for the same reason — "the user would lose work with no way to tell
              // it had happened" — and this wrote blindly. Chat sends no cwd, so the
              // target is ~/Documents: a document titled "Report" destroyed an
              // existing Report.pdf, and in cowork a title of "Index" overwrote
              // index.html in the project folder.
              for (const existing of [resolved.target.htmlPath, resolved.target.pdfPath]) {
                try {
                  await fsp.access(existing);
                  return {
                    content: [{
                      type: "text" as const,
                      text:
                        `Did not write the document: ${existing} already exists. Ask the user ` +
                        `whether to replace it, or use a different title.`,
                    }],
                  };
                } catch { /* absent — good */ }
              }

              // The HTML always lands, so there is a usable document even when
              // Chromium is not available to print.
              await fsp.writeFile(resolved.target.htmlPath, html, "utf-8");

              // Printing needs a client that will ACT on the relay event (see
              // pending-documents). A scheduled run has no callback at all, so the
              // HTML written above is the whole deliverable in that case.
              const htmlOnly = () => ({
                content: [{
                  type: "text" as const,
                  text: describeOutcome({ title, htmlPath: resolved.target.htmlPath }),
                }],
              });
              if (!onDocumentPrint) return htmlOnly();

              // Unguessable: this id is the only thing tying a resolution on the
              // unauthenticated /api/chat/document-result route back to the print
              // that opened it. See issueHandle for the threat that buys.
              const printId = issueHandle('doc');
              await onDocumentPrint(printId, {
                // The PATH, not the 20KB-and-up string. The `writeFile` above has
                // already put it on disk, so sending the markup as well copied it
                // into the SSE frame, out to the renderer, back over IPC and then
                // into a ~3x-inflated data URL — four copies of a file Chromium
                // can simply open. Embedded base64 images make that megabytes.
                htmlPath: resolved.target.htmlPath,
                outputPath: resolved.target.pdfPath,
                printOptions: printOptionsForTheme(
                  typeof input.theme === "string" ? input.theme : undefined,
                  title,
                ),
              });
              const result = await waitForDocumentPrint(printId, waitOptions);

              // NOBODY ANSWERED. That is not a rendering failure, and the
              // difference matters: `onDocumentPrint` exists on every chat request,
              // so its presence never proved anyone was consuming the stream. The
              // webhook route fetches /api/chat/<surface> and never reads
              // response.body, so `document_print` could not possibly be acted on —
              // and the model was told the invented failure "PDF rendering timed
              // out." instead of the honest fallback this branch restores.
              if (result.unclaimed) {
                console.warn("[Claude] Nothing acted on the document print — reporting HTML only");
                return htmlOnly();
              }

              // A reported success is a CLAIM. It arrives on a localhost route that
              // authenticates nothing, so believing it blindly let the model tell
              // the user about a PDF that was never written. Cheap to check.
              const bytesOnDisk = await fsp
                .stat(resolved.target.pdfPath)
                .then((s) => s.size)
                .catch(() => 0);
              const printed = result.ok && bytesOnDisk > 0;
              if (result.ok && !printed) {
                console.warn("[Claude] Print reported success but no PDF is on disk:", resolved.target.pdfPath);
              }

              return {
                content: [{
                  type: "text" as const,
                  text: describeOutcome({
                    title,
                    htmlPath: resolved.target.htmlPath,
                    ...(printed
                      ? { pdfPath: resolved.target.pdfPath }
                      : {
                          pdfError: result.ok
                            ? "the print was reported as succeeding but no PDF was written."
                            : result.error,
                        }),
                  }),
                }],
              };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { content: [{ type: "text" as const, text: `Could not create the document: ${msg}` }] };
            }
          }
        ),
        // Save the user's writing voice, usually after analysing samples they
        // pasted (P4). Writes VOICE.md directly — same reasoning as SkillCreate.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'VoiceProfileSave',
          "Save a description of the USER's writing voice, so future drafts you write for them sound like them. Use after they share samples of their own writing and ask you to learn or match their style. Describe what you actually observed in the samples — be specific and testable (\"sentences average 12 words\", \"never uses semicolons\"), never vague (\"professional yet friendly\"). This governs prose you draft FOR them, not your own replies.",
          {
            tone: z.string().optional().describe('How it should feel to read — e.g. "dry and direct, never chummy".'),
            sentenceRhythm: z.string().optional().describe('Typical sentence and paragraph length, and how much they vary.'),
            vocabulary: z.string().optional().describe('Characteristic words and phrases; register and jargon level.'),
            structure: z.string().optional().describe('How a piece opens, orders its points, and closes.'),
            avoid: z.string().optional().describe('Constructions, clichés and habits to stay away from.'),
          },
          async (input: Record<string, unknown>) => {
            try {
              const { serializeVoiceProfile, hasVoice } = await import('../identity/voice');
              const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
              const profile = {
                tone: str(input.tone),
                'sentence-rhythm': str(input.sentenceRhythm),
                vocabulary: str(input.vocabulary),
                structure: str(input.structure),
                avoid: str(input.avoid),
              };
              if (!hasVoice(profile)) {
                return { content: [{ type: 'text' as const, text: 'Nothing was saved — describe at least one aspect of the voice.' }] };
              }

              const os = await import('os');
              const path = await import('path');
              const fsp = await import('fs/promises');
              const dir = path.join(os.homedir(), '.claude');
              await fsp.mkdir(dir, { recursive: true });
              await fsp.writeFile(path.join(dir, 'VOICE.md'), serializeVoiceProfile(profile), 'utf-8');

              const saved = Object.entries(profile).filter(([, v]) => v).map(([k]) => k);
              return { content: [{ type: 'text' as const, text: `Saved the writing voice (${saved.join(', ')}). Drafts you write for the user from the next message on will match it. It is stored at ~/.claude/VOICE.md and can be edited there.` }] };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { content: [{ type: 'text' as const, text: `Could not save the writing voice: ${msg}` }] };
            }
          }
        ),
        // Author a reusable skill from the conversation and save it (P3.7).
        // Unlike CronCreate/WidgetCreate this needs no client round-trip: skills
        // are files on disk and this server runs server-side, so it writes
        // directly and reports the real outcome to the model.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'SkillCreate',
          'Save a reusable skill so the user can run this same procedure again later. Use when the user asks you to remember how to do something, turn what you just did into a repeatable command, or "make me a skill". Write the body as clear step-by-step instructions addressed to yourself for next time — it becomes a SKILL.md the user can invoke by name.',
          {
            name: z.string().describe('Short human name, e.g. "Weekly Board Pack". Becomes the folder name in slug form.'),
            description: z.string().describe('One line explaining when this skill should be used. Shown in the skills list and used by the model to decide relevance.'),
            body: z.string().describe('The skill instructions in Markdown — the actual procedure, written as steps.'),
            argumentHint: z.string().optional().describe('Placeholder shown when the user invokes it, e.g. "<report-name>".'),
            allowedTools: z.array(z.string()).optional().describe('Restrict the skill to these tools. Omit to allow all.'),
          },
          async (input: Record<string, unknown>) => {
            try {
              const { slugifySkillName, buildSkillMd, resolveSkillDir } = await import('../skills/create');
              const os = await import('os');
              const path = await import('path');
              const fsp = await import('fs/promises');

              const slug = slugifySkillName(input.name);
              if (!slug.ok) {
                return { content: [{ type: 'text' as const, text: `Could not save the skill: ${slug.error}` }] };
              }
              const skillsDir = path.join(os.homedir(), '.claude', 'skills');
              const resolved = resolveSkillDir(skillsDir, slug.slug);
              if (!resolved.ok) {
                return { content: [{ type: 'text' as const, text: `Could not save the skill: ${resolved.error}` }] };
              }

              // Refuse to clobber an existing skill — the user would lose work
              // with no way to tell it had happened.
              try {
                await fsp.access(path.join(resolved.dir, 'SKILL.md'));
                return { content: [{ type: 'text' as const, text: `A skill named "${slug.slug}" already exists. Ask the user whether to replace it, or pick a different name.` }] };
              } catch { /* does not exist — good */ }

              const md = buildSkillMd({
                name: String(input.name),
                description: typeof input.description === 'string' ? input.description : '',
                body: typeof input.body === 'string' ? input.body : '',
                argumentHint: typeof input.argumentHint === 'string' ? input.argumentHint : undefined,
                allowedTools: Array.isArray(input.allowedTools)
                  ? (input.allowedTools as unknown[]).filter((t): t is string => typeof t === 'string')
                  : undefined,
              });

              await fsp.mkdir(resolved.dir, { recursive: true });
              await fsp.writeFile(path.join(resolved.dir, 'SKILL.md'), md, 'utf-8');
              console.log('[Claude] SkillCreate wrote', resolved.dir);
              return { content: [{ type: 'text' as const, text: `Saved as the skill "${slug.slug}". The user can run it from the skills list, or by name in chat. It is available from the next message.` }] };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { content: [{ type: 'text' as const, text: `Could not save the skill: ${msg}` }] };
            }
          }
        ),
        // Ask the user to connect a service the current task needs. Intercepted
        // in canUseTool, which pauses the turn until they answer — see
        // pending-connectors.ts. The handler only reports the outcome that the
        // interception already injected.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tool as any)(
          'RequestConnector',
          'Ask the user to connect a service you need for the current task but which is not connected yet (e.g. you were asked to send an email and no mail tool is available). Shows them a one-click Connect button and pauses until they answer; if they accept, the service becomes usable and you continue. Only request a service listed as connectable in your system prompt, only when the task needs it, and at most one per turn.',
          {
            connectorId: z.string().describe('The connector id exactly as listed in the system prompt, e.g. "github", "atlassian".'),
            reason: z.string().describe('One short sentence, shown to the user, saying what you need it for. E.g. "to send the summary to Bob".'),
          },
          async (input: Record<string, unknown>) => {
            const connectorId = String(input.connectorId ?? '');
            const record = connectorRequests.get(connectorId);
            // Consumed, not read: an outcome belongs to the single tool call that
            // produced it. A replayed handler invocation is not a second connect.
            const outcome = record?.reported ? undefined : record?.outcome;
            if (record) record.reported = true;

            if (outcome?.connected) {
              // The mounted MCP set is fixed for the life of this request, so the
              // newly connected server's tools do NOT exist in this session. Saying
              // "retry the step" would send the agent at a tool that isn't there.
              return {
                content: [{
                  type: 'text' as const,
                  text:
                    `${connectorId} is now connected. Its tools are NOT available in this ` +
                    `turn — the tool set was fixed when this message started. Tell the user ` +
                    `it is connected and ask them to send another message so you can use it.`,
                }],
              };
            }
            return {
              content: [{
                type: 'text' as const,
                text:
                  `Not connected${outcome?.reason ? `: ${outcome.reason}` : ''}. Do not ask ` +
                  `again this turn. Finish what you can without it and tell the user which ` +
                  `part you could not do.`,
              }],
            };
          }
        ),
      ],
    });

    // Build query options
    const queryOptions: Record<string, unknown> = {
      allowedTools,
      // Removes them from the model's context entirely, so it never reaches for
      // one and never has to be refused mid-turn.
      disallowedTools: [...denied],
      maxTurns,
      mcpServers: {
        ...mcpServers,
        aime: aimeMcpServer,
        // Web search is opt-in: requires a SearXNG instance (SEARXNG_INSTANCES env var)
        ...(process.env.SEARXNG_INSTANCES
          ? {
              'web-search': {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@jharding_npm/mcp-server-searxng'],
                env: {
                  SEARXNG_INSTANCES: process.env.SEARXNG_INSTANCES,
                  MCP_SEARXNG_DEBUG: process.env.MCP_SEARXNG_DEBUG || 'false',
                },
              },
            }
          : {}),
      },
      permissionMode,
      // Required by SDK when permissionMode is 'bypassPermissions'. Without it,
      // the SDK may fail to handle certain tool calls (e.g. MCP tools with
      // complex schemas) because it tries to render a permission prompt that
      // we don't have the bridge for.
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
      settingSources: ['user', 'project'], // Enable Skills from filesystem
      ...(pluginPaths.length > 0 && {
        plugins: pluginPaths.map(p => ({ type: 'local', path: p })),
      }),
    };

    // ── Native SDK options: thinking, effort, fallback, prompt suggestions ──
    if (sessionControls?.thinkLevel && sessionControls.thinkLevel !== 'off') {
      const { THINK_LEVEL_TOKENS } = await import('../slash-commands');
      const level = sessionControls.thinkLevel;
      queryOptions.thinking = level === 'adaptive'
        ? { type: 'adaptive' }
        : { type: 'enabled', budgetTokens: THINK_LEVEL_TOKENS[level] };
      console.log('[Claude] Thinking:', level, queryOptions.thinking);
    }

    if (sessionControls?.effortLevel) {
      queryOptions.effort = sessionControls.effortLevel;
      console.log('[Claude] Effort:', sessionControls.effortLevel);
    }

    // Fallback model — auto-downgrade if primary model fails (rate limit, etc)
    const fallbacks: Record<string, string> = { opus: 'sonnet', sonnet: 'haiku', coding: 'fast' };
    if (model && fallbacks[model]) {
      queryOptions.fallbackModel = fallbacks[model];
    }

    // Prompt suggestions — Chat surface only
    if (surfaceId === 'chat') {
      queryOptions.promptSuggestions = true;
    }

    // In packaged Electron builds, the SDK can't find its CLI binary via import.meta.url
    // because the bundler minifies module paths. The instrumentation hook sets globalThis
    // from the AIME_SDK_CLI_PATH env var passed by the Electron main process.
    const sdkCliPath = (globalThis as Record<string, unknown>).__aimeClaudeSDKPath as string | undefined;
    if (sdkCliPath) {
      queryOptions.pathToClaudeCodeExecutable = sdkCliPath;
    }

    // Capture every stderr line from cli.js — when it exits 1 before producing
    // any structured output (e.g. native-binary load failure on Windows arm64),
    // its actual error only goes to stderr. The SDK's exit-code error doesn't
    // include this, so without piping it ourselves we're flying blind.
    queryOptions.stderr = (data: string) => {
      console.error('[cli.js stderr]', data);
    };

    // Loop detection window for this query
    const loopWindow: Array<{ name: string; inputHash: string }> = [];
    const LOOP_WARN_THRESHOLD = 3;
    const LOOP_DENY_THRESHOLD = 5;

    /**
     * Tool-use ids currently blocked on a human answer.
     *
     * The per-tool watchdog below measures wall-clock time since a tool_use block
     * arrived, and while the SDK loop is paused inside canUseTool waiting for a
     * person, that measurement means nothing — no tool can finish. Without this,
     * an approval prompt (or an AskUserQuestion, or an OAuth round trip via
     * RequestConnector, which budgets 300s) was aborted after 90s: a gate nobody
     * who steps away from their desk could answer.
     */
    const awaitingHuman = new Set<string>();

    /** Tools the user declined during this request — see the gate below. */
    const deniedThisTurn = new Set<string>();
    /** Cards shown for destructive commands this turn; see the cap below. */
    const commandApprovalsAsked = [0];
    const MAX_COMMAND_APPROVALS_PER_TURN = 5;

    /**
     * Per-tool MCP approval gate (P3.6b, made enforceable).
     *
     * Scoped to exactly the remote servers this request mounted — the in-process
     * `aime` server and `web-search` are added to queryOptions further down and
     * are deliberately NOT in here, so the app's own tools keep working without
     * prompts. Built-ins (Write/Edit/Bash) are unchanged too: on an interactive
     * surface the human is watching the stream and holds abort.
     *
     * Reads the user's standing decisions once per request. Skipped entirely when
     * no remote server is mounted, which is the common case and costs no I/O.
     */
    const remoteMcpServers = mcpServers as Record<string, unknown>;
    let toolGate: ToolGate | null = null;
    let mcpConfigPath: string | null = null;
    if (Object.keys(remoteMcpServers).length > 0) {
      let decisions: ToolDecisions = {};
      try {
        const { getMcpConfigPath } = await import('../app-paths');
        mcpConfigPath = getMcpConfigPath();
        decisions = await readToolDecisions(mcpConfigPath);
      } catch {
        // No readable decision store ⇒ nothing is pre-approved, so the gate asks.
      }
      toolGate = buildToolGate(remoteMcpServers, decisions);
    }

    // Detect if this is a background/scheduled execution (not interactive)
    const isBackgroundRun = chatId.startsWith('standing-order-') || chatId.startsWith('subagent_') || chatId.startsWith('hb-') || chatId.startsWith('widget-');

    /**
     * Approval policy (P6/C3). Explicit per-query when provided (a Goal carries
     * one); otherwise unattended runs gate consequential actions and
     * interactive sessions gate nothing — in an interactive session the human
     * is watching the stream and holds the abort button, which IS the approval
     * mechanism.
     *
     * This replaced a hardcoded ten-name tool list. That list was wrong in both
     * directions — every newly added MCP connector tool sailed through
     * ungoverned, and its deny message claimed "an approval card has been
     * created" when no such machinery existed. The classifier judges by effect
     * (world-side vs in-app vs read) and its deny message promises nothing it
     * doesn't do.
     */
    const approvalPolicy = params.approvalPolicy ?? (isBackgroundRun ? 'consequential' : 'never');

    // Intercept AskUserQuestion, browser tools, canvas tool, and loop detection via canUseTool.
    queryOptions.canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      { toolUseID }: { toolUseID: string },
    ) => {
      // ── Withheld tools ──────────────────────────────────────────────────
      // Before everything, including the MCP policy: this is the configuration
      // saying the tool does not exist for this run.
      //
      // `disallowedTools` above should already mean the model never asks — but
      // that is the SDK's promise about its own context assembly, and this gate
      // is the one piece that runs whatever `permissionMode` says. The whole
      // class of bug being fixed here is a control that looked enforced because
      // a name had been filtered out of a list somewhere upstream, so the check
      // that matters lives where nothing can route around it.
      if (toolMatches(toolName, denied)) {
        console.warn('[SECURITY] Blocked a tool withheld from this run:', toolName);
        return {
          behavior: 'deny' as const,
          message:
            `${toolName} is not available in this session — it has been turned off in ` +
            `settings. Do not try it again or look for another way to run it. Tell the ` +
            `user which part of the task needs it and do what you can without it.`,
        };
      }

      // ── Writes must stay inside the working directory ───────────────────
      // Enforced here rather than requested in the prompt, because a path is one
      // of the few things about a tool call that IS decidable: resolve it, and
      // either it is under the base or it is not.
      //
      // Honest about its scope. It governs the file TOOLS; a shell redirect
      // (`echo x > /etc/y`) resolves nothing here and walks straight past, which
      // is why the setting's description now says so and why the command gate
      // below is what watches the shell.
      if (security.restrictToProjectFolder && effectiveCwd && isFileWriteTool(toolName)) {
        const target = writeTargetOf(input);
        if (target) {
          if (!writeTargetAllowed(target, effectiveCwd)) {
            console.warn('[SECURITY] Blocked a write outside the working directory:', target);
            return {
              behavior: 'deny' as const,
              message:
                `${toolName} was refused: ${target} is outside the working directory, and this ` +
                `session is restricted to it. Do not retry it or try to reach the same place ` +
                `another way. Write inside the working directory, or tell the user what you ` +
                `need to put where and let them decide.`,
            };
          }
        }
      }

      // ── Destructive shell commands: ask a human ─────────────────────────
      // A prompt, not a block — see lib/security/destructive-commands for why a
      // shell blocklist is the wrong shape and why asking is the right one.
      if (
        security.blockDangerousCommands &&
        toolMatches(toolName, SHELL_TOOLS) &&
        typeof input.command === 'string'
      ) {
        const command = input.command;
        const verdict = classifyCommand(command);
        if (verdict.destructive) {
          // Keyed by the COMMAND, not the tool: declining one `rm -rf` must not
          // silently refuse every later `ls`. Tool-name keying is right for the
          // MCP gate, where the name is the risk; here the risk is the argument.
          // Normalised, so trivial respellings are the SAME refusal. Keyed on the
          // exact string, `rm -rf x` and `rm  -rf x` and `rm -rf "x"` were three
          // different keys, each earning a fresh card — and the deny path returns
          // before loop detection, so nothing capped it. A model steered by an
          // injected instruction could prompt until the user clicked Allow.
          const key = `shell:${command.replace(/["']/g, '').replace(/\s+/g, ' ').trim()}`;
          if (deniedThisTurn.has(key)) {
            return {
              behavior: 'deny' as const,
              message:
                `That command was already declined in this turn and will not be asked again. ` +
                `Stop retrying it and finish what you can without it.`,
            };
          }
          // A hard ceiling on cards per turn, on top of the per-command memory:
          // a turn that has already asked this many times is not going to become
          // more legitimate, and every extra modal makes the next one likelier to
          // be dismissed unread.
          if (commandApprovalsAsked[0] >= MAX_COMMAND_APPROVALS_PER_TURN) {
            console.warn('[SECURITY] Approval prompt limit reached for this turn');
            return {
              behavior: 'deny' as const,
              message:
                `This turn has already asked the user to approve ${MAX_COMMAND_APPROVALS_PER_TURN} ` +
                `commands, so no more will be shown. Stop and tell them what is left to do.`,
            };
          }
          commandApprovalsAsked[0] += 1;
          if (!onInputRequest) {
            // Unattended: nothing can ask, so under this setting it does not run.
            console.warn('[SECURITY] Cannot ask about a destructive command here; denying');
            return {
              behavior: 'deny' as const,
              message:
                `That command looks like ${verdict.reason} and needs the user's approval, but ` +
                `this session cannot ask them (no interactive client attached). It was not run. ` +
                `Say what you would have done and let them run it from a chat window.`,
            };
          }

          const question = buildCommandApprovalQuestion(command, verdict.reason!);
          awaitingHuman.add(toolUseID);
          // A nonce, not the SDK's toolUseID — /api/chat/answer authenticates
          // nothing else, so presenting this is the only proof an "Allow" came
          // from the card the user was actually shown. See issueHandle.
          const approvalHandle = issueHandle(toolUseID);
          let decision: ApprovalDecision;
          let unanswered = false;
          try {
            await onInputRequest(approvalHandle, [question]);
            decision = readApprovalAnswer(await waitForAnswer(approvalHandle, waitOptions), question.question);
          } catch {
            decision = 'deny';
            unanswered = true;
          } finally {
            awaitingHuman.delete(toolUseID);
          }
          console.log('[SECURITY] Destructive command approval →', decision);

          // The card offers Allow once / Deny only, and readApprovalAnswer fails
          // closed, so anything that is not an explicit allow is a refusal.
          if (decision !== 'allow-once' && decision !== 'always-allow') {
            deniedThisTurn.add(key);
            return {
              behavior: 'deny' as const,
              message: unanswered
                ? `That command was not run: the approval prompt timed out because the user did ` +
                  `not respond. Do not retry it. Tell them it is still waiting on them and carry on.`
                : `That command was not run — the user did not approve it. Do not retry it or ` +
                  `look for another way to do the same thing. Tell them which part of the task ` +
                  `you could not do, and carry on with the rest.`,
            };
          }
        }
      }

      // ── Per-tool MCP policy: the user's standing denial ─────────────────
      // First, and in every mode. A tool the user blocked must not run because
      // the run happens to be unattended, or because a later branch allows it.
      const mcpTool = toolGate?.resolve(toolName) ?? null;
      const mcpPolicy = mcpTool?.policy ?? null;
      if (mcpPolicy === 'always_deny' && mcpTool) {
        console.warn('[Governance] Blocked a tool the user denied:', toolName);
        return {
          behavior: 'deny' as const,
          message:
            `${mcpTool.tool} was not run: it is blocked for ${mcpTool.server}. Do not try ` +
            `it again. Tell the user it is blocked, and that they can change that in ` +
            `Customize → Connectors. Continue with whatever else you can do.`,
        };
      }

      // ── Governance: approval policy for unattended runs ─────────────────
      if (approvalPolicy !== 'never') {
        const { evaluateApproval } = await import('../runs/approval');
        const outcome = evaluateApproval(approvalPolicy, toolName, input);
        if (!outcome.allow) {
          console.warn('[Governance] Paused', outcome.class, 'tool in unattended run:', toolName, 'chatId:', chatId);
          return { behavior: 'deny' as const, message: outcome.reason! };
        }
      } else if (mcpPolicy === 'always_ask' && mcpTool) {
        // ── The interactive gate ─────────────────────────────────────────
        // approvalPolicy 'never' means "the human is watching", which is only an
        // approval mechanism if they are actually asked. bypassPermissions turns
        // off the SDK's own prompt, so this is where the ask has to happen.

        // A "no" holds for the rest of the turn. Loop detection can't help here
        // (a denial returns before the window is touched), so without this an
        // agent — or a prompt injection steering one — could re-call the tool and
        // put the same card in front of the user until they clicked Allow.
        if (deniedThisTurn.has(toolName)) {
          return {
            behavior: 'deny' as const,
            message:
              `${mcpTool.tool} was already declined in this turn and will not be asked ` +
              `again. Stop trying it and finish what you can without it.`,
          };
        }

        const handlesMoney = toolGate!.handlesMoney(mcpTool.server);
        if (!onInputRequest) {
          // Nothing can render a prompt on this surface, so there is no way to
          // ask — which under always_ask means the tool does not run. Allowing
          // it is what shipped before, and is what this exists to stop.
          console.warn('[Governance] Cannot ask for approval on this surface; denying', toolName);
          return {
            behavior: 'deny' as const,
            message:
              `${mcpTool.tool} needs the user's approval and this session cannot ask them ` +
              `(no interactive client attached). It was not run. Say what you would have ` +
              `done and let them run it from a chat window.`,
          };
        }

        const question = buildApprovalQuestion({
          server: mcpTool.server,
          tool: mcpTool.tool,
          handlesMoney,
        });
        awaitingHuman.add(toolUseID);
        // The card echoes this back to /api/chat/answer, which authenticates
        // nobody — so it is a nonce, not the SDK's toolUseID. An "Allow" that
        // nothing proves came from the card the user was shown is not an approval
        // at all, and this gate exists precisely to make the approval real.
        const approvalHandle = issueHandle(toolUseID);
        let decision: ApprovalDecision;
        let unanswered = false;
        try {
          await onInputRequest(approvalHandle, [question]);
          decision = readApprovalAnswer(await waitForAnswer(approvalHandle, waitOptions), question.question, {
            handlesMoney,
          });
        } catch {
          // waitForAnswer rejects on its own timeout. No answer is not an answer,
          // but it is worth telling apart from a decline: the user was away, not
          // opposed, so the agent should say the prompt expired.
          decision = 'deny';
          unanswered = true;
        } finally {
          awaitingHuman.delete(toolUseID);
        }
        console.log('[Governance] Approval for', toolName, '→', decision);

        if (decision === 'always-allow' || decision === 'always-deny') {
          const remembered = decision === 'always-allow' ? 'always_allow' : 'always_deny';
          toolGate!.remember(mcpTool.server, mcpTool.tool, remembered);
          if (mcpConfigPath) {
            // Fire-and-forget: a decision that fails to persist still governed
            // this call, and the user is simply asked again next time.
            void recordToolDecision(mcpConfigPath, mcpTool.server, mcpTool.tool, remembered);
          }
        }

        if (decision === 'deny' || decision === 'always-deny') {
          deniedThisTurn.add(toolName);
          return {
            behavior: 'deny' as const,
            message: unanswered
              ? `${mcpTool.tool} was not run: the approval prompt timed out because the user ` +
                `did not respond. Do not retry it. Tell them it is still waiting on them and ` +
                `carry on with the rest.`
              : `${mcpTool.tool} was not run — the user did not approve it` +
                `${decision === 'always-deny' ? ' and has blocked it from now on' : ''}. ` +
                `Do not retry it. Tell them which part of the task you could not do, and ` +
                `carry on with the rest.`,
          };
        }
        // allow-once / always-allow fall through, so loop detection still applies.
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
      // Warn after 3 consecutive identical calls (log only — don't mutate input,
      // as MCP tools have strict Zod schemas that reject unknown fields)
      if (consecutiveCount >= LOOP_WARN_THRESHOLD) {
        console.warn('[Claude] Loop warning for tool:', toolName, 'id:', toolUseID, `(${consecutiveCount} consecutive identical calls)`);
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
        awaitingHuman.add(toolUseID);
        // Nonce, not the tool use id — see issueHandle. The answers land in
        // `updatedInput` and become what the model believes the user said.
        const answerHandle = issueHandle(toolUseID);
        try {
          await onInputRequest(answerHandle, input.questions);
          const answers = await waitForAnswer(answerHandle, waitOptions);
          return {
            behavior: 'allow' as const,
            updatedInput: { ...input, answers },
          };
        } catch (err) {
          // The wait rejects on its own timeout and, now, when the turn is
          // stopped. Both used to throw out of canUseTool and into the SDK loop;
          // reporting it is what the agent can actually act on.
          const msg = err instanceof Error ? err.message : String(err);
          return {
            behavior: 'deny' as const,
            message: `The question was not answered (${msg}). Do not re-ask it; say what you still need.`,
          };
        } finally {
          awaitingHuman.delete(toolUseID);
        }
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
        // Rejects on timeout and on a stopped turn. Turned into an error RESULT
        // rather than thrown: the agent can react to "that step failed", and
        // throwing out of canUseTool just kills the loop.
        const result = await waitForBrowserToolResult(toolUseID, waitOptions).catch(
          (err: unknown) => ({
            output: err instanceof Error ? err.message : String(err),
            isError: true,
          }),
        );
        return {
          behavior: 'allow' as const,
          updatedInput: { ...input, __browserToolResult: result.output, __isError: result.isError },
        };
      }

      // ── Connector request (P3.3) ───────────────────────────────────────
      // Pause the turn while the user connects, then resume with the outcome so
      // the agent can retry the step instead of abandoning the task.
      if ((toolName === 'RequestConnector' || toolName.endsWith('__RequestConnector')) && onConnectorRequest) {
        const connectorId = typeof input.connectorId === 'string' ? input.connectorId : '';
        const reason = typeof input.reason === 'string' ? input.reason : '';
        if (!connectorId) {
          connectorRequests.set('', {
            outcome: { connected: false, reason: 'No connector id was given.' },
          });
          return { behavior: 'allow' as const };
        }

        // The one-per-connector rule the tool description states, now enforced.
        // The handler can only look an outcome up by connector id, so a second
        // card for the same service creates two answers competing for one slot —
        // which is exactly how a successful connect came to be reported as a
        // decline. A PENDING request counts: the SDK client permits concurrent
        // can_use_tool dispatch, so both blocks can be in flight at once.
        const existing = connectorRequests.get(connectorId);
        if (existing) {
          console.warn('[Claude] Refusing a repeat connector request for', connectorId);
          return {
            behavior: 'deny' as const,
            message:
              `${connectorId} has already been requested in this turn, so it was not asked ` +
              `again. Do not retry it. Its tools would not be usable this turn in any case — ` +
              `finish what you can without it and tell the user which part you could not do.`,
          };
        }

        console.log('[Claude] Connector requested:', connectorId, 'id:', toolUseID);
        const record: ConnectorRequestRecord = {};
        connectorRequests.set(connectorId, record);
        // OAuth + sign-in + possibly 2FA. waitForConnector budgets 300s, so the
        // 90s tool watchdog must not count this as a hang.
        awaitingHuman.add(toolUseID);
        // Nonce, not the tool use id — see issueHandle. This is the resolution
        // that most needs binding: a fabricated `connected: true` reaches the
        // model as "the service is wired up now", which it then tells the user.
        const connectHandle = issueHandle(toolUseID);
        let result;
        try {
          await onConnectorRequest(connectHandle, connectorId, reason);
          result = await waitForConnector(connectHandle, waitOptions);
        } finally {
          awaitingHuman.delete(toolUseID);
        }
        // Recorded where the handler can actually read it. Passing it through
        // updatedInput looked correct and was silently discarded by the schema.
        record.outcome = result;
        return { behavior: 'allow' as const };
      }

      return { behavior: 'allow' as const };
    };

    // Set working directory — use selected folder, or fall back to a per-chat
    // scratch dir so the agent never defaults to the app's own source tree.
    // Using a per-chat path (not a shared temp) ensures session resumption
    // works even if the client-side scratchDir hook hasn't resolved yet.
    if (cwd) {
      queryOptions.cwd = cwd;
      console.log('[Claude] Working directory set to:', cwd);
    } else {
      const os = await import('os');
      const path = await import('path');
      const fs = await import('fs');
      const { getScratchDir } = await import('../app-paths');
      const safeCwd = chatId
        ? getScratchDir(chatId)
        : path.join(os.tmpdir(), 'aime-sandbox');
      fs.mkdirSync(safeCwd, { recursive: true });
      queryOptions.cwd = safeCwd;
      console.log('[Claude] No folder selected — using scratch directory:', safeCwd);
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
    const { getDataDir } = await import('../app-paths');
    const { CLAUDECODE: _cc, ...safeEnv } = process.env;
    queryOptions.env = {
      ...safeEnv,
      CLAUDE_CONFIG_DIR: getDataDir(),
    };

    // BYOK: a user-provided API key routes directly to the Anthropic API
    // and takes priority over Bedrock env.
    if (apiKey) {
      queryOptions.env = {
        ...safeEnv,
        ...(queryOptions.env as Record<string, string> || {}),
        ANTHROPIC_API_KEY: apiKey,
      };
      console.log('[Claude] API key provided, routing to the Anthropic API');
    } else if (isBedrockConfigured()) {
      queryOptions.env = { ...safeEnv, ...(queryOptions.env as Record<string, string> || {}), ...getBedrockEnv() };
      console.log('[Claude] Bedrock env configured, routing through AWS');
    }

    // A user-added provider (OpenRouter's anthropic endpoint, a self-hosted
    // gateway, or the local openai-compat shim) supplies an Anthropic-compat
    // base URL. Point the SDK at it. Applies on top of whichever key branch ran.
    if (baseUrl) {
      queryOptions.env = {
        ...(queryOptions.env as Record<string, string> || {}),
        ANTHROPIC_BASE_URL: baseUrl,
      };
      console.log('[Claude] Custom Anthropic-compatible base URL configured');
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

    // Register the abort controller created at the top of this method.
    // Use composite key (surfaceId:chatId) for concurrent surface support.
    const abortKey = this.getAbortKey(chatId, surfaceId);
    if (chatId) {
      this.abortControllers.set(abortKey, abortController);
    }

    // Per-tool watchdog: abort the query if any single tool runs past
    // TOOL_DEADLINE_MS. The SDK doesn't expose per-tool timeouts, and
    // WebFetch in particular can hang for many minutes when its model-
    // backed summarization step is slow (e.g. nib AI Studio Gateway
    // queueing). Without this, a single hung tool freezes the whole
    // session until the user manually aborts.
    const TOOL_DEADLINE_MS = 90_000;
    const activeTools = new Map<string, { name: string; startedAt: number }>();
    // Use a single-element array so TS doesn't narrow to `never` —
    // the assignment below happens inside an interval callback which
    // isn't visible to TS's control-flow analysis.
    const watchdogTrip: Array<{ name: string; elapsedMs: number }> = [];
    const watchdog = setInterval(() => {
      const now = Date.now();
      // While the turn is blocked on a human decision the SDK loop is paused, so
      // NO active tool can finish and elapsed wall-clock time stops being
      // evidence of a hang. Roll their clocks forward rather than accusing them:
      // this is what stops the 90s deadline from aborting an approval prompt, an
      // AskUserQuestion or an OAuth round trip that a user takes a minute over.
      if (awaitingHuman.size > 0) {
        for (const info of activeTools.values()) info.startedAt = now;
        return;
      }
      for (const [id, info] of activeTools) {
        const elapsed = now - info.startedAt;
        if (elapsed > TOOL_DEADLINE_MS) {
          console.warn(`[Claude] Tool ${info.name} (id=${id}) hung ${(elapsed / 1000).toFixed(0)}s, aborting query`);
          watchdogTrip.push({ name: info.name, elapsedMs: elapsed });
          abortController.abort();
          activeTools.clear();
          break;
        }
      }
    }, 5000);

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
          // Tool budget (P3.5): connecting more services must not silently
          // degrade tool selection, so count what actually got mounted.
          if (Array.isArray(data.tools)) {
            const toolNames = (data.tools as unknown[]).filter((t): t is string => typeof t === 'string');
            initData.tools = toolNames;
            const { summarizeToolBudget } = await import('../mcp/filter');
            const budget = summarizeToolBudget(toolNames);
            initData.toolBudget = budget;
            if (budget.overBudget) console.warn('[Claude] Tool budget:', budget.advice);
            // Remember what each server exposes so the NEXT session can carry a
            // per-tool permission policy (P3.6b) — names are only knowable once
            // a session has connected.
            try {
              const { groupToolsByServer } = await import('../mcp/tool-policy');
              const { recordObservedTools } = await import('../mcp/observed-tools');
              const { getMcpConfigPath } = await import('../app-paths');
              await recordObservedTools(getMcpConfigPath(), groupToolsByServer(toolNames));
            } catch { /* advisory only */ }
          }
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

        // Handle prompt suggestions (Chat surface)
        if (c.type === 'prompt_suggestion') {
          yield {
            type: 'prompt_suggestion',
            suggestion: c.suggestion as string,
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

                // Intercept canvas tool — emit canvas SSE event instead of regular tool_use.
                // If the agent passed { templateId, input }, expand via the template registry
                // so downstream consumers always see a fully-rendered A2UIDocument.
                // The tool may arrive as bare `canvas` or MCP-prefixed `mcp__quarry__canvas`.
                if (toolName === CANVAS_TOOL_NAME || toolName === 'mcp__aime__canvas') {
                  const expanded = expandCanvasTemplate(toolInput);
                  const doc = expanded ?? toolInput;
                  const rawSummary = JSON.stringify(toolInput).slice(0, 600);
                  console.log('[Claude] Canvas tool use — emitting canvas event', expanded ? `(template: ${(toolInput as Record<string, unknown>).templateId})` : '(raw)', '| input:', rawSummary);
                  yield {
                    type: 'canvas',
                    doc,
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
                } else if (/(?:^|__|:)(WidgetCreate|StandingOrderCreate)$/.test(toolName)) {
                  // Same treatment as CronCreate: emit while the client is still
                  // reading. The post-stream flush cannot help on a user Stop —
                  // that aborts the fetch, so nothing is left to receive it — and
                  // the tool has already told the user "pinned to your Cockpit".
                  const type = toolName.endsWith('WidgetCreate')
                    ? ('widget_create' as const)
                    : ('standing_order_create' as const);
                  emittedEffects.add(effectKey(type, toolInput));
                  console.log(`[Claude] ${toolName} tool use — emitting ${type} mid-stream`);
                  yield {
                    type,
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
                  activeTools.set(block.id as string, { name: toolName, startedAt: Date.now() });
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
          activeTools.delete(toolUseId);
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

      yield* drainPending();

      // Signal completion
      yield {
        type: 'done',
        provider: this.name,
      };

      console.log('[Claude] Stream completed');
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[Claude] Query aborted for chatId:', chatId);
        // Before reporting the abort: whatever was already created is still
        // created, and the model has already told the user so. See drainPending.
        yield* drainPending();
        const trip = watchdogTrip[0];
        if (trip) {
          // Surface the watchdog reason so the user sees what hung
          // instead of a generic "aborted" — the abort here was ours.
          yield {
            type: 'error',
            message: `Tool "${trip.name}" exceeded ${(trip.elapsedMs / 1000).toFixed(0)}s and was aborted. The downstream call (e.g. WebFetch's gateway-side summarization) hung. Try again or rephrase.`,
            provider: this.name,
          };
        }
        yield {
          type: 'aborted',
          provider: this.name,
        };
      } else {
        throw error;
      }
    } finally {
      clearInterval(watchdog);
      // Clean up abort controller using composite key
      if (chatId) {
        this.abortControllers.delete(abortKey);
      }
    }
  }
}
