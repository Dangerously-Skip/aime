'use client';

import { useEffect, useRef } from 'react';
import { useAssistantStore } from '@/stores/assistant-store';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * Drives auto-refreshing dashboard widgets in the Assistant surface.
 *
 * Each card with a `widget` block is re-fired on the heartbeat schedule:
 *   - On every minute:tick we check `widget.refreshIntervalMs`
 *   - If `(now - lastRefreshedAt) >= refreshIntervalMs`, we POST the
 *     `regeneratePrompt` to /api/chat/<surface> and replace the card body
 *     with the resulting text + canvas doc.
 *
 * Widgets are pinned by default so they survive store restarts.
 */
export function useAssistantWidgets() {
  const cards = useAssistantStore((s) => s.cards);
  const updateCard = useAssistantStore((s) => s.updateCard);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);

  // Use a ref so the heartbeat handler always sees fresh cards without resubscribing.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { onMinuteTick?: (cb: (ts: number) => void) => void } }).electronAPI;
    if (!api?.onMinuteTick) return;

    const inFlight = new Set<string>();

    const refreshWidget = async (cardId: string, prompt: string, surface: string) => {
      if (inFlight.has(cardId)) return;
      inFlight.add(cardId);
      try {
        const chatId = `widget-${cardId}`;
        const response = await fetch(`/api/chat/${surface}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: prompt,
            chatId,
            model: 'sonnet',
            apiKey: nibGatewayApiKey || undefined,
          }),
        });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let doc: import('@/lib/a2ui/types').A2UIDocument | undefined;
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
                text += event.content;
              } else if (event.type === 'canvas' && event.doc) {
                doc = event.doc as import('@/lib/a2ui/types').A2UIDocument;
              }
            } catch { /* ignore */ }
          }
        }

        const updates: Partial<import('@/stores/assistant-store').AssistantCard> = {
          summary: text || undefined,
          doc,
          timestamp: Date.now(),
        };
        // Bump lastRefreshedAt on the existing widget block.
        const card = cardsRef.current.find((c) => c.id === cardId);
        if (card?.widget) {
          updates.widget = { ...card.widget, lastRefreshedAt: Date.now() };
        }
        updateCard(cardId, updates);
      } finally {
        inFlight.delete(cardId);
      }
    };

    const handler = () => {
      const now = Date.now();
      for (const card of cardsRef.current) {
        if (!card.widget) continue;
        const last = card.widget.lastRefreshedAt ?? 0;
        if (now - last < card.widget.refreshIntervalMs) continue;
        refreshWidget(card.id, card.widget.regeneratePrompt, card.widget.surface ?? 'assistant');
      }
    };

    api.onMinuteTick(handler);
  }, [nibGatewayApiKey, updateCard]);
}
