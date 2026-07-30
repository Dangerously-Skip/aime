'use client';

import type { ChunkType } from '@/lib/providers/base-provider';

/**
 * The conversation-stream contract every surface store already satisfied.
 *
 * `chat-store`, `cowork-store` and `code-store` each independently grew the SAME
 * nine actions with the SAME signatures — the interface existed, it just had no
 * name, so the stream handling that consumes it was written three times.
 *
 * Naming it is what makes the handling shareable. `core-chunks.test.ts` asserts
 * all three still satisfy it, so a store that drifts is a build failure rather
 * than a fourth divergent copy.
 */
export interface ConversationStreamStore {
  addMessage: (chatId: string, message: StreamMessage) => void;
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  addToolCall: (chatId: string, toolCall: ToolCallInit) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  completeRunningTools: (chatId: string) => void;
}

/** The message shape all three stores accept, narrowed to what the stream sets. */
export interface StreamMessage {
  id: string;
  role: 'assistant';
  content: string;
  timestamp: number;
  questionData?: unknown;
  questionToolUseId?: string;
  connectorRequest?: { connectorId: string; reason?: string; toolUseId: string };
}

/** The tool-call shape all three stores accept. */
export interface ToolCallInit {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'complete' | 'error';
  startTime: number;
}

/**
 * Chunks whose handling is identical on every conversation surface.
 *
 * Distinct from `agnostic-chunks`: those write to a GLOBAL store and need no
 * surface context at all. These write to the surface's own conversation store,
 * which is why they need one passed in — but the logic on top of it is the same
 * everywhere, and was triplicated.
 */
export type CoreChunkType =
  | 'turn_start'
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  // The three RELAY chunks. Each one PAUSES THE TURN server-side until the client
  // answers, so a surface that does not handle one does not merely lose a feature
  // — it hangs. `canRelayToClient` defaults to true and no surface overrides it,
  // so the route hands the provider these callbacks on every stream, from every
  // surface. Code handled none of the three: a connector request there stalled
  // the turn for 300s and a document print for 60s before timing out.
  | 'input_request'
  | 'connector_request'
  | 'document_print'
  | 'canvas';

const CORE: readonly ChunkType[] = [
  'turn_start',
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'error',
  'input_request',
  'connector_request',
  'document_print',
  'canvas',
] satisfies readonly CoreChunkType[];

export interface CoreChunkContext {
  chatId: string;
  store: ConversationStreamStore;
  /**
   * Adjust a tool's input before it is recorded.
   *
   * Cowork resolves a relative `file_path` against the working directory so the
   * artifact panel's Open button works. Expressed as a hook rather than folded
   * in, because it is genuinely cowork-only — the surface has a cwd and the
   * others do not.
   */
  normaliseToolInput?: (name: string, input: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Called after a tool call is recorded, for whatever else the surface does
   * with it — chat files it as a project artifact, cowork starts a stuck-tool
   * watchdog and sniffs for a cron pattern.
   *
   * These are the REAL differences between the three copies. Making them named
   * callbacks means they are visible in one place instead of buried in 150 lines
   * of near-identical switch.
   */
  onToolStarted?: (toolId: string, name: string, input: Record<string, unknown>) => void;
  /**
   * Print a rendered document. REQUIRED, not optional, and that is the point:
   * the turn is blocked waiting for this, so a surface that forgets it hangs for
   * 60s. Making it a required field turns "forgot" into a compile error.
   */
  printDocument: (payload: {
    toolUseId: string;
    htmlPath: string;
    outputPath: string;
    printOptions?: Record<string, unknown>;
  }) => void;
  /** Render a canvas document. Required for the same reason. */
  onCanvas: (event: { doc?: unknown }) => void;
  /** OS notification when the window is unfocused and the turn needs a human. */
  notify?: (title: string, body: string) => void;
  /**
   * Start a stuck-tool watchdog for a tool that has just begun.
   *
   * Existed on cowork ONLY, written when a large PDF read hung there — and chat
   * and code have the identical failure mode with no watchdog at all. Optional
   * because it needs the surface's own store to observe tool status, but every
   * conversation surface should pass it.
   */
  watchTool?: (toolId: string, name: string) => void;
  /**
   * Core chunks this surface still handles itself.
   *
   * A migration affordance, not a design: cowork's `tool_use`/`tool_result` carry
   * a lot of surface-specific work (a stuck-tool watchdog, artifact
   * categorisation, a QUARRY_CRON sniffer over both input and output) that would
   * be misrepresented as a one-line callback. Listing them here keeps the opt-out
   * VISIBLE and typed, rather than a surface quietly not calling the shared
   * handler at all — which is the failure mode this whole exercise is about.
   *
   * `core-chunks.test.ts` records the current skips, so shrinking the list is a
   * deliberate act and growing it is a conversation.
   */
  skip?: readonly CoreChunkType[];
}

export function isCoreChunk(type: string): type is CoreChunkType {
  return (CORE as readonly string[]).includes(type);
}

/**
 * Handle a chunk whose behaviour is the same on every conversation surface.
 * Returns true when it took the event.
 *
 * `turn_start` and `text` both complete running tools first: the Agent SDK does
 * not always emit `tool_result`, so text arriving after a tool is the signal that
 * the tool finished. That reasoning was duplicated in three comments; it lives
 * here now.
 */
export function handleCoreChunk(
  event: Record<string, unknown>,
  ctx: CoreChunkContext,
): boolean {
  const { chatId, store } = ctx;
  const type = event.type;
  if (typeof type !== 'string' || !isCoreChunk(type)) return false;
  if (ctx.skip?.includes(type)) return false;

  switch (type) {
    case 'turn_start':
      store.completeRunningTools(chatId);
      return true;

    case 'text':
      store.completeRunningTools(chatId);
      store.appendToLastAssistant(chatId, (event.content as string) || '');
      return true;

    case 'thinking':
      store.appendToLastAssistant(chatId, '', (event.content as string) || '');
      return true;

    case 'tool_use': {
      store.completeRunningTools(chatId);
      const toolId = (event.id as string) || `tool_${Date.now()}`;
      const name = (event.name as string) || 'Unknown';
      const raw = (event.input as Record<string, unknown>) || {};
      const input = ctx.normaliseToolInput ? ctx.normaliseToolInput(name, raw) : raw;
      store.addToolCall(chatId, { id: toolId, name, input, status: 'running', startTime: Date.now() });
      // Watchdog before the surface extras: the point is to catch a tool that
      // never finishes, so arming it must not depend on what follows.
      ctx.watchTool?.(toolId, name);
      ctx.onToolStarted?.(toolId, name, input);
      return true;
    }

    case 'tool_result':
      store.updateToolResult(
        chatId,
        (event.tool_use_id as string) || (event.id as string) || '',
        typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
        event.is_error as boolean | undefined,
      );
      return true;

    case 'error':
      store.appendToLastAssistant(
        chatId,
        `\n\n**Error:** ${(event.message as string) || 'An error occurred'}`,
      );
      return true;

    case 'input_request':
      store.addMessage(chatId, {
        id: (event.toolUseId as string) || `q_${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        questionData: event.questions,
        questionToolUseId: event.toolUseId as string,
      });
      ctx.notify?.('Claude needs your input', 'A question or permission prompt is waiting for you.');
      return true;

    case 'connector_request':
      store.addMessage(chatId, {
        id: (event.toolUseId as string) || `conn_${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        connectorRequest: {
          connectorId: event.connectorId as string,
          reason: event.reason as string | undefined,
          toolUseId: event.toolUseId as string,
        },
      });
      ctx.notify?.('A connection is needed', 'AIME is waiting to connect a service.');
      return true;

    case 'document_print':
      // Paths only — the document itself never enters the renderer; Electron main
      // owns Chromium and reads it from disk.
      ctx.printDocument({
        toolUseId: event.toolUseId as string,
        htmlPath: event.htmlPath as string,
        outputPath: event.outputPath as string,
        printOptions: event.printOptions as Record<string, unknown> | undefined,
      });
      return true;

    case 'canvas':
      ctx.onCanvas(event as { doc?: unknown });
      return true;
  }
}
