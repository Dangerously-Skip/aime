'use client';

import { useEffect, useRef } from 'react';
import { useAssistantStore } from '@/stores/assistant-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useContextBusStore } from '@/stores/context-bus-store';
import { evaluateStandingOrders, hashSnapshot } from '@/lib/standing-order-engine';

/**
 * Standing Order execution hook.
 * Subscribes to minute:tick, evaluates standing orders, executes matches,
 * and produces cards in the assistant store.
 */
export function useStandingOrders() {
  const executingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onMinuteTick?: (cb: (ts: number) => void) => void } }).electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = async (ts: number) => {
      const now = new Date(ts);
      const orders = useAssistantStore.getState().orders;
      const matched = evaluateStandingOrders(orders, now);

      for (const order of matched) {
        // Prevent concurrent execution of the same order
        if (executingRef.current.has(order.id)) continue;
        executingRef.current.add(order.id);

        try {
          await executeOrder(order);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[StandingOrders] Execution error:', order.id, msg);

          // Track errors — auto-pause after 3 consecutive
          const currentOrder = useAssistantStore.getState().getOrder(order.id);
          const newErrorCount = (currentOrder?.errorCount ?? 0) + 1;
          useAssistantStore.getState().updateOrder(order.id, { errorCount: newErrorCount });

          if (newErrorCount >= 3) {
            useAssistantStore.getState().pauseOrder(order.id);
            useAssistantStore.getState().addCard({
              title: `Order paused: ${order.instruction.slice(0, 40)}`,
              summary: `Auto-paused after ${newErrorCount} consecutive errors. Last error: ${msg}`,
            });
          }

          useAssistantStore.getState().addActivity({
            type: 'order-error',
            label: `Error: ${msg.slice(0, 100)}`,
            orderId: order.id,
          });
        } finally {
          executingRef.current.delete(order.id);
        }
      }
    };

    api.onMinuteTick(handler);
  }, []);
}

/**
 * Execute a single standing order: call the API, produce a card, update state.
 */
async function executeOrder(order: import('@/stores/assistant-store').StandingOrder): Promise<void> {
  const nibGatewayApiKey = useSettingsStore.getState().nibGatewayApiKey;

  // Build prompt with accumulated state context
  let prompt = order.instruction;
  if (Object.keys(order.state).length > 0) {
    const stateJson = JSON.stringify(order.state, null, 2);
    // If state is getting large, ask for compaction
    if (stateJson.length > 40000) {
      prompt += `\n\nPrevious context (LARGE — please consolidate and keep only what's still relevant):\n${stateJson}`;
    } else {
      prompt += `\n\nPrevious context from this standing order:\n${stateJson}`;
    }
  }
  prompt += `\n\nThis is execution #${order.runCount + 1}.`;
  prompt += `\n\nAfter your response, output a line starting with STATE: followed by a JSON object containing any facts worth remembering for the next execution (e.g., topics covered, values seen, items completed). Keep it under 1KB. Example: STATE: {"lastPrice": 198.50, "topicsCovered": ["transformers", "RLHF"]}`;

  const chatId = `standing-order-${order.id}-${Date.now()}`;

  const response = await fetch('/api/chat/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: prompt,
      chatId,
      model: 'sonnet',
      apiKey: nibGatewayApiKey || undefined,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`API returned ${response.status}: ${response.statusText}`);
  }

  // Stream the response and collect full text
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let executionCost = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === 'text' && typeof event.content === 'string') {
          fullText += event.content;
        } else if (event.type === 'done' && event.usage) {
          executionCost = (event.usage as { cost?: number }).cost || 0;
        }
      } catch { /* ignore */ }
    }
  }

  if (!fullText.trim()) {
    throw new Error('Empty response from agent');
  }

  // Check if output changed from last run (snapshot diffing)
  const newHash = hashSnapshot(fullText);
  if (order.lastSnapshotHash === newHash && order.condition) {
    // No change and order has a condition — skip card creation
    useAssistantStore.getState().updateOrder(order.id, {
      lastRun: Date.now(),
      runCount: order.runCount + 1,
      lastSnapshotHash: newHash,
      errorCount: 0,
    });
    return;
  }

  // Extract state from output (STATE: {...} line)
  const stateMatch = fullText.match(/STATE:\s*(\{[\s\S]*?\})\s*$/m);
  let extractedState: Record<string, unknown> = {};
  let displayText = fullText;
  if (stateMatch) {
    try {
      extractedState = JSON.parse(stateMatch[1]);
      // Remove STATE: line from display text
      displayText = fullText.replace(/STATE:\s*\{[\s\S]*?\}\s*$/m, '').trim();
    } catch { /* ignore parse errors */ }
  }

  // Try to parse A2UI document from output
  let a2uiDoc: import('@/lib/a2ui/types').A2UIDocument | undefined;
  const a2uiMatch = displayText.match(/```(?:a2ui|json)\s*\n([\s\S]*?)\n```/);
  if (a2uiMatch) {
    try {
      const parsed = JSON.parse(a2uiMatch[1]);
      if (parsed.version && parsed.components) {
        a2uiDoc = parsed;
        displayText = displayText.replace(/```(?:a2ui|json)\s*\n[\s\S]*?\n```/, '').trim();
      }
    } catch { /* not valid A2UI */ }
  }

  // Create card with the result
  useAssistantStore.getState().addCard({
    orderId: order.id,
    title: order.instruction.slice(0, 60),
    summary: displayText.slice(0, 2000),
    ...(a2uiDoc ? { doc: a2uiDoc } : {}),
  });

  // Publish to context bus for cross-surface communication
  const notifyVia = order.notifyVia || 'assistant';
  const targetSurface = notifyVia.startsWith('inject:') ? notifyVia.slice(7) : undefined;
  const priority = targetSurface ? 'p0' : 'p2';

  useContextBusStore.getState().publish({
    source: `standing-order:${order.id}`,
    priority: priority as 'p0' | 'p1' | 'p2',
    targetSurface,
    summary: `[${order.instruction.slice(0, 40)}] ${fullText.slice(0, 500)}`,
    payload: { orderId: order.id, fullText: fullText.slice(0, 2000) },
  });

  // Desktop notification for P0 events
  if (priority === 'p0') {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Standing Order: ${order.instruction.slice(0, 40)}`, {
        body: fullText.slice(0, 100),
      });
    }
  }

  // Update order state (merge extracted state + cost)
  const mergedState = Object.keys(extractedState).length > 0
    ? { ...order.state, ...extractedState }
    : order.state;
  useAssistantStore.getState().updateOrder(order.id, {
    lastRun: Date.now(),
    runCount: order.runCount + 1,
    lastResult: displayText.slice(0, 1000),
    lastSnapshotHash: newHash,
    errorCount: 0,
    state: mergedState,
    totalCost: (order.totalCost || 0) + executionCost,
  });

  // Activity log
  useAssistantStore.getState().addActivity({
    type: 'order-fired',
    label: `Executed: ${order.instruction.slice(0, 60)}`,
    orderId: order.id,
  });

  // Check completion condition (simple keyword match for now)
  if (order.completionCondition) {
    const lowerOutput = fullText.toLowerCase();
    const lowerCondition = order.completionCondition.toLowerCase();
    if (lowerOutput.includes('completed') || lowerOutput.includes('done') || lowerOutput.includes(lowerCondition)) {
      useAssistantStore.getState().completeOrder(order.id);
    }
  }

  // Check max executions
  if (order.maxExecutions && order.runCount + 1 >= order.maxExecutions) {
    useAssistantStore.getState().completeOrder(order.id);
  }

  // Check expiry
  if (order.expiresAt && Date.now() >= order.expiresAt) {
    useAssistantStore.getState().updateOrder(order.id, { status: 'expired' });
  }

  // Notification
  if (order.notifyVia === 'toast') {
    // Show desktop notification
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`Standing Order: ${order.instruction.slice(0, 40)}`, {
        body: fullText.slice(0, 100),
      });
    }
  }
}
