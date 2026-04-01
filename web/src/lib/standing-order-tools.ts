/**
 * Standing Order MCP tool handlers.
 * These are intercepted in canUseTool (claude-provider.ts) and executed in-process.
 * They read/write the assistant store directly via HTTP calls to the client.
 *
 * Since canUseTool runs server-side (in the Next.js API route), these tools
 * communicate with the assistant store via a dedicated API endpoint.
 */

import type { StandingOrder } from '@/stores/assistant-store';

interface StandingOrderInput {
  instruction?: string;
  trigger_type?: 'cron' | 'interval' | 'event';
  expression?: string;
  event?: string;
  condition?: string;
  completionCondition?: string;
  agentName?: string;
  notifyVia?: string;
  maxExecutions?: number;
  expiresInHours?: number;
}

/**
 * Create a standing order from tool input.
 * Returns a description of what was created.
 */
export function buildStandingOrderFromInput(input: StandingOrderInput): Omit<StandingOrder, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'errorCount' | 'state' | 'status'> {
  return {
    instruction: input.instruction || '',
    agentName: input.agentName,
    trigger: {
      type: input.trigger_type || 'interval',
      expression: input.expression,
      event: input.event,
    },
    condition: input.condition,
    completionCondition: input.completionCondition,
    notifyVia: input.notifyVia || 'assistant',
    maxExecutions: input.maxExecutions,
    expiresAt: input.expiresInHours ? Date.now() + input.expiresInHours * 3600000 : undefined,
  };
}

/**
 * Format a standing order for display in tool output.
 */
export function formatOrderSummary(order: StandingOrder): string {
  const parts = [
    `ID: ${order.id}`,
    `Instruction: ${order.instruction}`,
    `Trigger: ${order.trigger.type}${order.trigger.expression ? ` (${order.trigger.expression})` : ''}`,
    `Status: ${order.status}`,
    `Runs: ${order.runCount}`,
  ];
  if (order.condition) parts.push(`Condition: ${order.condition}`);
  if (order.completionCondition) parts.push(`Completes when: ${order.completionCondition}`);
  if (order.lastRun) parts.push(`Last run: ${new Date(order.lastRun).toLocaleString()}`);
  if (order.lastResult) parts.push(`Last result: ${order.lastResult.slice(0, 200)}`);
  return parts.join('\n');
}

/**
 * Format a list of standing orders for display.
 */
export function formatOrderList(orders: StandingOrder[]): string {
  if (orders.length === 0) return 'No standing orders found.';
  return orders.map((o, i) => `${i + 1}. [${o.status}] ${o.instruction.slice(0, 60)} (${o.trigger.type}: ${o.trigger.expression || o.trigger.event || 'n/a'}, runs: ${o.runCount})`).join('\n');
}
