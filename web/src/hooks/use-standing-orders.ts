'use client';

import { useEffect, useRef } from 'react';
import { useAssistantStore } from '@/stores/assistant-store';
import { useSettingsStore } from '@/stores/settings-store';
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
    prompt += `\n\nPrevious context from this standing order:\n${JSON.stringify(order.state, null, 2)}`;
  }
  prompt += `\n\nThis is execution #${order.runCount + 1}.`;

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

  // Create card with the result
  useAssistantStore.getState().addCard({
    orderId: order.id,
    title: order.instruction.slice(0, 60),
    summary: fullText.slice(0, 2000),
  });

  // Update order state
  useAssistantStore.getState().updateOrder(order.id, {
    lastRun: Date.now(),
    runCount: order.runCount + 1,
    lastResult: fullText.slice(0, 1000),
    lastSnapshotHash: newHash,
    errorCount: 0,
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
