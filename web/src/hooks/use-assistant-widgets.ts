'use client';

import { useEffect, useRef } from 'react';
import { useAssistantStore } from '@/stores/assistant-store';
import { getWidgetPreset } from '@/lib/assistant/widget-presets';

/**
 * Refreshes dashboard widgets on the heartbeat (and once on mount).
 *
 * Each card with a `widget` block dispatches by `widget.kind` to the
 * corresponding preset's client-side `fetchAndRender()`. No LLM round-trip,
 * no SDK process — just public APIs / pure computation.
 */
export function useAssistantWidgets() {
  const cards = useAssistantStore((s) => s.cards);
  const updateCard = useAssistantStore((s) => s.updateCard);

  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const refreshOne = async (cardId: string, kind: string) => {
    const preset = getWidgetPreset(kind);
    if (!preset) return;
    try {
      const doc = await preset.fetchAndRender();
      const card = cardsRef.current.find((c) => c.id === cardId);
      const widget = card?.widget;
      updateCard(cardId, {
        doc,
        summary: undefined,
        timestamp: Date.now(),
        widget: widget ? { ...widget, lastRefreshedAt: Date.now() } : undefined,
      });
    } catch (err) {
      console.error('[widgets] refresh failed:', kind, err);
    }
  };

  // Initial fetch — fire any widget that hasn't been refreshed yet.
  useEffect(() => {
    for (const card of cardsRef.current) {
      if (card.widget && !card.widget.lastRefreshedAt) {
        refreshOne(card.id, card.widget.kind);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect newly added widgets and prime them.
  useEffect(() => {
    for (const card of cards) {
      if (card.widget && !card.widget.lastRefreshedAt) {
        refreshOne(card.id, card.widget.kind);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  // Periodic refresh on the heartbeat tick.
  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onMinuteTick?: (cb: (ts: number) => void) => void } }).electronAPI;
    if (!api?.onMinuteTick) return;

    const handler = () => {
      const now = Date.now();
      for (const card of cardsRef.current) {
        if (!card.widget) continue;
        const last = card.widget.lastRefreshedAt ?? 0;
        if (now - last < card.widget.refreshIntervalMs) continue;
        refreshOne(card.id, card.widget.kind);
      }
    };

    api.onMinuteTick(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
