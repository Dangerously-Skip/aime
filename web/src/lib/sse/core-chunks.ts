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
  appendToLastAssistant: (chatId: string, content: string, thinking?: string) => void;
  addToolCall: (chatId: string, toolCall: ToolCallInit) => void;
  updateToolResult: (chatId: string, toolCallId: string, output: string, isError?: boolean) => void;
  completeRunningTools: (chatId: string) => void;
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
export type CoreChunkType = 'turn_start' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error';

const CORE: readonly ChunkType[] = [
  'turn_start',
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'error',
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
  }
}
