/**
 * Server-side standing-order execution — C5b.
 *
 * A port of the renderer's executeOrder with one structural change: it cannot
 * touch renderer stores, so every side effect the renderer used to apply
 * directly (cards, context-bus posts, notifications, order-state updates)
 * comes back as DATA — a manifest patch plus inbox entries the renderer
 * replays and acknowledges. Same prompt building, same STATE extraction, same
 * snapshot-skip; the completion check uses the same verifier as everything
 * else (fail closed: an unreachable verifier keeps the order running).
 *
 * The chatId keeps the `standing-order-` prefix, so C3's approval policy
 * gates consequential tools exactly as it did for renderer-driven runs.
 */
import { hashSnapshot } from '@/lib/standing-order-engine';
import { startRun, finishRun, costFromStreamUsage } from '@/lib/runs/runs';
import { appendRun } from '@/lib/runs/run-log';
import { verifyRunAgainstGoal } from '@/lib/runs/verify-service';
import { standingOrderToGoal } from '@/lib/runs/standing-order-goal';
import type { Run } from '@/lib/runs/types';
import type { InboxEntry, ManifestOrder } from './manifest';

export interface OrderExecutionResult {
  /** Field updates for the manifest (and, via inbox replay, the renderer). */
  patch: Partial<ManifestOrder>;
  entries: InboxEntry[];
  run: Run;
}

/** Auto-pause threshold, matching the old renderer behaviour. */
export const PAUSE_AFTER_CONSECUTIVE_ERRORS = 3;

const entryId = () => `in_${globalThis.crypto.randomUUID()}`;

/** Build the prompt with accumulated state — ported verbatim in behaviour. */
function buildPrompt(order: ManifestOrder): string {
  let prompt = order.instruction;
  if (Object.keys(order.state).length > 0) {
    const stateJson = JSON.stringify(order.state, null, 2);
    if (stateJson.length > 40_000) {
      prompt += `\n\nPrevious context (LARGE — please consolidate and keep only what's still relevant):\n${stateJson}`;
    } else {
      prompt += `\n\nPrevious context from this standing order:\n${stateJson}`;
    }
  }
  prompt += `\n\nThis is execution #${order.runCount + 1}.`;
  prompt += `\n\nAfter your response, output a line starting with STATE: followed by a JSON object containing any facts worth remembering for the next execution (e.g., topics covered, values seen, items completed). Keep it under 1KB. Example: STATE: {"lastPrice": 198.50, "topicsCovered": ["transformers", "RLHF"]}`;
  return prompt;
}

export async function executeOrderServerSide(order: ManifestOrder): Promise<OrderExecutionResult> {
  const now = Date.now();
  let run: Run = startRun({
    id: globalThis.crypto.randomUUID(),
    now,
    goalId: `so:${order.id}`,
    trigger: 'cron',
    surfaceId: 'assistant',
    model: 'sonnet',
  });

  const fail = async (error: string): Promise<OrderExecutionResult> => {
    run = finishRun(run, { now: Date.now(), status: 'failed', error });
    await appendRun(run).catch(() => false);

    const errorCount = order.errorCount + 1;
    const paused = errorCount >= PAUSE_AFTER_CONSECUTIVE_ERRORS;
    const entries: InboxEntry[] = [
      { id: entryId(), orderId: order.id, ts: Date.now(), kind: 'error', title: order.instruction.slice(0, 60), error: error.slice(0, 300), notifyVia: order.notifyVia },
    ];
    if (paused) {
      entries.push({
        id: entryId(),
        orderId: order.id,
        ts: Date.now(),
        kind: 'paused',
        title: `Order paused: ${order.instruction.slice(0, 40)}`,
        summary: `Auto-paused after ${errorCount} consecutive errors. Last error: ${error.slice(0, 200)}`,
        notifyVia: order.notifyVia,
      });
    }
    return {
      patch: { lastRun: now, errorCount, ...(paused ? { status: 'paused' as const } : {}) },
      entries,
      run,
    };
  };

  // ── Execute ─────────────────────────────────────────────────────────────
  let fullText = '';
  let usage: { inputTokens?: number; outputTokens?: number; cost?: number } | undefined;
  try {
    const { getProvider } = await import('@/lib/providers');
    const { getServerAnthropicKey } = await import('@/lib/models/credentials');
    const provider = getProvider('claude');
    const apiKey = await getServerAnthropicKey();

    for await (const chunk of provider.query({
      prompt: buildPrompt(order),
      chatId: `standing-order-${order.id}-${now}`,
      surfaceId: 'assistant',
      model: 'sonnet',
      apiKey,
    })) {
      if (chunk.type === 'text') fullText += (chunk.content as string) ?? '';
      else if (chunk.type === 'done' && chunk.usage) {
        usage = chunk.usage as { inputTokens?: number; outputTokens?: number; cost?: number };
      }
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'execution failed');
  }

  if (!fullText.trim()) return fail('Empty response from agent');

  const cost = costFromStreamUsage(usage);
  run = finishRun(run, { now: Date.now(), status: 'succeeded', cost });
  await appendRun(run).catch(() => false);

  // ── Snapshot skip: unchanged output on a conditional order → no card ────
  const newHash = hashSnapshot(fullText);
  if (order.lastSnapshotHash === newHash && order.condition) {
    return {
      patch: { lastRun: now, runCount: order.runCount + 1, lastSnapshotHash: newHash, errorCount: 0 },
      entries: [],
      run,
    };
  }

  // ── STATE extraction ────────────────────────────────────────────────────
  const stateMatch = fullText.match(/STATE:\s*(\{[\s\S]*?\})\s*$/m);
  let extractedState: Record<string, unknown> = {};
  let displayText = fullText;
  if (stateMatch) {
    try {
      extractedState = JSON.parse(stateMatch[1]);
      displayText = fullText.replace(/STATE:\s*\{[\s\S]*?\}\s*$/m, '').trim();
    } catch {
      /* unparseable STATE line — leave text as-is */
    }
  }

  // ── A2UI document extraction (for the assistant card) ──────────────────
  let docJson: string | undefined;
  const a2uiMatch = displayText.match(/```(?:a2ui|json)\s*\n([\s\S]*?)\n```/);
  if (a2uiMatch) {
    try {
      const parsed = JSON.parse(a2uiMatch[1]);
      if (parsed.version && parsed.components) {
        docJson = a2uiMatch[1];
        displayText = displayText.replace(/```(?:a2ui|json)\s*\n[\s\S]*?\n```/, '').trim();
      }
    } catch {
      /* not a valid A2UI doc */
    }
  }

  const entries: InboxEntry[] = [
    {
      id: entryId(),
      orderId: order.id,
      ts: Date.now(),
      kind: 'result',
      title: order.instruction.slice(0, 60),
      summary: displayText.slice(0, 2_000),
      docJson,
      notifyVia: order.notifyVia,
    },
  ];

  const mergedState =
    Object.keys(extractedState).length > 0 ? { ...order.state, ...extractedState } : order.state;
  const patch: Partial<ManifestOrder> = {
    lastRun: now,
    runCount: order.runCount + 1,
    lastSnapshotHash: newHash,
    errorCount: 0,
    state: mergedState,
    totalCost: (order.totalCost ?? 0) + (cost?.totalUsd ?? 0),
  };

  // ── Completion (verified, never keyword-matched; fails closed) ─────────
  if (order.completionCondition) {
    const goal = {
      ...standingOrderToGoal({ ...order, lastRun: now }),
      successCriteria: `The completion condition has now been met: ${order.completionCondition}`,
    };
    const verdict = await verifyRunAgainstGoal(goal, run, fullText.slice(0, 4_000));
    if (verdict.passed) {
      patch.status = 'completed';
      entries.push({
        id: entryId(),
        orderId: order.id,
        ts: Date.now(),
        kind: 'completed',
        title: `Order complete: ${order.instruction.slice(0, 40)}`,
        summary: verdict.note,
        notifyVia: order.notifyVia,
      });
    }
  }

  // ── Max executions / expiry ────────────────────────────────────────────
  if (order.maxExecutions && order.runCount + 1 >= order.maxExecutions) {
    patch.status = 'completed';
  }
  if (order.expiresAt && Date.now() >= order.expiresAt) {
    patch.status = 'expired';
  }

  return { patch, entries, run };
}
