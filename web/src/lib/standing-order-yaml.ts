/**
 * Standing Order YAML import/export.
 * Uses JSON as the serialization format (YAML-like but no dependency needed).
 */

import type { StandingOrder } from '@/stores/assistant-store';

/**
 * Export standing orders as a downloadable JSON file.
 */
export function exportOrdersToJson(orders: StandingOrder[]): void {
  const exportData = orders.map((o) => ({
    instruction: o.instruction,
    agentName: o.agentName,
    trigger: o.trigger,
    condition: o.condition,
    completionCondition: o.completionCondition,
    notifyVia: o.notifyVia,
    maxExecutions: o.maxExecutions,
    status: o.status,
  }));

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `standing-orders-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import standing orders from a JSON string.
 * Returns parsed orders ready for addOrder.
 */
export function parseOrdersFromJson(
  jsonString: string
): Array<Omit<StandingOrder, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'errorCount' | 'state' | 'status'>> {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data)) throw new Error('Expected an array of standing orders');

  return data.map((item: Record<string, unknown>) => ({
    instruction: String(item.instruction || ''),
    agentName: item.agentName as string | undefined,
    trigger: (item.trigger as StandingOrder['trigger']) || { type: 'interval', expression: '1h' },
    condition: item.condition as string | undefined,
    completionCondition: item.completionCondition as string | undefined,
    notifyVia: (item.notifyVia as string) || 'assistant',
    maxExecutions: item.maxExecutions as number | undefined,
  }));
}
