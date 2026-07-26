'use client';

import { useWidgetStore } from '@/stores/widget-store';
import { parseIntervalSeconds } from '@/lib/runs/standing-order-goal';
import type { Widget } from './widget';

/**
 * Handle a `widget_create` SSE event — the chat → Cockpit pin loop (P6/K5).
 * The model called WidgetCreate; the provider queued and emitted it; this lands
 * it in the widget store where the Cockpit grid picks it up.
 *
 * Returns the created widget, or null when the payload was unusable (never
 * throws — a bad tool call must not break the stream that carried it).
 */
export function handleWidgetCreateEvent(event: Record<string, unknown>): Widget | null {
  const input = event.input as
    | { title?: unknown; recipe?: unknown; refreshEvery?: unknown; allowWeb?: unknown }
    | undefined;
  if (!input || typeof input.title !== 'string' || typeof input.recipe !== 'string') return null;
  if (!input.title.trim() || !input.recipe.trim()) return null;

  const widget: Widget = {
    id: typeof event.id === 'string' && event.id ? event.id : globalThis.crypto.randomUUID(),
    title: input.title.trim().slice(0, 120),
    recipe: input.recipe.trim().slice(0, 4_000),
    render: null,
    enabled: true,
    createdAt: Date.now(),
    allowWeb: input.allowWeb === true,
    refreshEverySeconds:
      typeof input.refreshEvery === 'string'
        ? (parseIntervalSeconds(input.refreshEvery) ?? undefined)
        : undefined,
  };

  useWidgetStore.getState().addWidget(widget);
  return widget;
}
