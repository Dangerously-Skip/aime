'use client';

import { useAssistantStore } from '@/stores/assistant-store';
import { handleWidgetCreateEvent } from '@/lib/widgets/handle-create-event';
import { handleMemoryExtractEvent } from '@/lib/memory/handle-extract-event';
import type { ChunkType } from '@/lib/providers/base-provider';

/**
 * Chunks whose handling does not depend on which surface received them — and the
 * one place they are handled.
 *
 * ## The bug class this closes
 *
 * The provider can emit these from ANY surface (the tools live on the in-process
 * `aime` MCP server, which is mounted everywhere), but each surface had its own
 * `switch (event.type)` with no `default`. So a chunk nobody remembered to add
 * fell through in silence while the tool had already told the user it worked. An
 * audit found three live instances, not one:
 *
 *   standing_order_create   handled on 1 of 5 surfaces
 *   cron_create             handled on 3 of 5
 *   memory_extract          handled on 3 of 5
 *   widget_create           handled on 2 of 5 (fixed by hand first, which is
 *                           what prompted looking properly)
 *
 * Fixing instances does not stop the next one. This does: `HANDLERS` is a
 * `Record<AgnosticChunkType, …>`, so adding a type to the union without a handler
 * is a COMPILE error, and every surface gets it by calling one function.
 *
 * The per-surface copies were byte-for-byte variants of the same logic anyway,
 * differing only in their log prefix — so there is no behaviour being collapsed
 * here, only duplication.
 *
 * ## The rule
 *
 * A surface must NOT case on any of these itself; doing so double-handles the
 * event. `agnostic-chunks.test.ts` enforces that, which is the inverted (and much
 * cheaper) form of the old "every surface must handle it" check: one assertion
 * instead of surfaces × chunk-types.
 */
export type AgnosticChunkType =
  | 'cron_create'
  | 'standing_order_create'
  | 'widget_create'
  | 'memory_extract';

/**
 * Compile-time proof that every agnostic type is a real chunk type. A typo here
 * would otherwise produce a handler that can never fire.
 */
const _agnosticAreRealChunks: readonly ChunkType[] = [
  'cron_create',
  'standing_order_create',
  'widget_create',
  'memory_extract',
] satisfies readonly AgnosticChunkType[];
void _agnosticAreRealChunks;

export interface AgnosticChunkContext {
  /** Conversation the stream belongs to — memory extraction is scoped to it. */
  chatId: string;
  /** Log prefix, e.g. 'Chat'. Cosmetic. */
  surface: string;
  /**
   * Where a created order should notify. Genuinely surface-dependent — the
   * Assistant shows it in its own feed, everywhere else wants a toast — so it is
   * a parameter rather than a divergence between five copies of the handler.
   */
  notifyVia?: 'assistant' | 'toast';
}

type Handler = (event: Record<string, unknown>, ctx: AgnosticChunkContext) => void;

/** A cron job and a standing order are the same thing to the engine. */
function addCronOrder(event: Record<string, unknown>, ctx: AgnosticChunkContext): void {
  const input = (event.input ?? {}) as Record<string, unknown>;
  // Key tolerance kept from the surfaces: the model has used all of these.
  const expression = (input.cron || input.expression) as string | undefined;
  const prompt = (input.prompt || input.message || input.task) as string | undefined;
  if (!expression || !prompt) return;
  useAssistantStore.getState().addOrder({
    instruction: prompt,
    trigger: { type: 'cron', expression },
    notifyVia: ctx.notifyVia ?? 'toast',
  });
  console.log(`[${ctx.surface}] Standing order created from CronCreate:`, expression, prompt);
}

/**
 * Taken from the Assistant surface's implementation, which was the only complete
 * one — it handled `trigger_type`, `condition`, `maxExecutions` and converted
 * `expiresInHours` into the absolute `expiresAt` the store stores. The chat and
 * cowork copies did not exist at all, so there was nothing to reconcile: the
 * richest version simply becomes the only version.
 */
function addStandingOrder(event: Record<string, unknown>, ctx: AgnosticChunkContext): void {
  const input = (event.input ?? {}) as {
    instruction?: string;
    trigger_type?: string;
    expression?: string;
    condition?: string;
    completionCondition?: string;
    agentName?: string;
    notifyVia?: string;
    maxExecutions?: number;
    expiresInHours?: number;
  };
  if (!input.instruction) return;
  useAssistantStore.getState().addOrder({
    instruction: input.instruction,
    agentName: input.agentName,
    trigger: {
      type: (input.trigger_type as 'cron' | 'interval' | 'event') || 'interval',
      expression: input.expression,
    },
    condition: input.condition,
    completionCondition: input.completionCondition,
    notifyVia: input.notifyVia || ctx.notifyVia || 'toast',
    maxExecutions: input.maxExecutions,
    expiresAt: input.expiresInHours ? Date.now() + input.expiresInHours * 3600000 : undefined,
  });
  console.log(`[${ctx.surface}] Standing order created:`, input.instruction);
}

/**
 * Exhaustive by construction. Add a member to `AgnosticChunkType` without an
 * entry here and this object fails to typecheck — which is the whole point.
 */
const HANDLERS: Record<AgnosticChunkType, Handler> = {
  cron_create: addCronOrder,
  standing_order_create: addStandingOrder,
  widget_create: (event) => handleWidgetCreateEvent(event),
  memory_extract: (event, ctx) =>
    handleMemoryExtractEvent(
      event.memories as Array<{
        content: string;
        category: string;
        tags: string[];
        confidence: number;
      }>,
      ctx.chatId,
    ),
};

export function isAgnosticChunk(type: string): type is AgnosticChunkType {
  return type in HANDLERS;
}

/**
 * Handle a surface-agnostic chunk. Returns true when it took the event, so a
 * caller can `return`/`break` before its own switch.
 *
 * Each handler is wrapped: a malformed payload from the model must not take the
 * whole stream down, and the surfaces all had their own try/catch for exactly
 * that reason.
 */
export function handleAgnosticChunk(
  event: Record<string, unknown>,
  ctx: AgnosticChunkContext,
): boolean {
  const type = event.type;
  if (typeof type !== 'string' || !isAgnosticChunk(type)) return false;
  try {
    HANDLERS[type](event, ctx);
  } catch (e) {
    console.error(`[${ctx.surface}] ${type} handler failed:`, e);
  }
  return true;
}
