'use client';

import { useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvas-store';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { sendFeatureAdoptionEvent } from '@/lib/telemetry/events';
import type { A2UIDocument } from '@/lib/a2ui/types';

/**
 * `code` renders a canvas but does not persist it per conversation: code-store
 * has no `canvasArtifacts` field, unlike chat-store and cowork-store. Extending
 * the union rather than writing a second canvas handler keeps this ONE
 * implementation — the reason it exists — and makes code's partial support
 * explicit instead of the canvas being silently dropped, which is what happened
 * before. Adding persistence is a code-store change, tracked as follow-up.
 */
export type CanvasSurfaceId = 'chat' | 'cowork' | 'code';

/**
 * One canvas SSE handler shared by the surfaces. Each surface used to inline
 * the same five state mutations (push, open, addArtifact, attachToMessage,
 * telemetry). Drift between them caused most of the canvas-related layout bugs.
 *
 * THE CHAT IS AN ARGUMENT, and it must be the stream's own. This hook used to
 * take the conversation on screen when the surface rendered, which is not the
 * conversation the canvas belongs to: a first turn starts before the surface
 * has re-rendered into its new conversation (so the canvas was filed under ''
 * and its chip never attached), and a canvas arriving after the user had moved
 * to another chat was filed under that one. `useSSEStream` hands every callback
 * the chat it was started for; pass that.
 *
 *     const onCanvas = useCanvasSseHandler('chat');
 *     // in onChunk(event, chatId):
 *     case 'canvas': onCanvas(event, chatId); break;
 */
export function useCanvasSseHandler(surfaceId: CanvasSurfaceId) {
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setCanvasOpen = useCanvasStore((s) => s.setOpen);

  return useCallback(
    (event: { doc?: unknown }, chatId: string) => {
      try {
        const doc = event.doc as A2UIDocument | undefined;
        if (!doc || !doc.components) {
          console.warn(`[${surfaceId}] canvas event dropped — doc malformed`, doc);
          return;
        }

        pushCanvas(surfaceId, doc, chatId || null);
        setCanvasOpen(surfaceId, true);

        // Persistence is per-surface; code has no artifact store yet.
        if (chatId && surfaceId !== 'code') {
          const canvasId = crypto.randomUUID();
          const title = doc.title || 'Canvas';
          const payload = { id: canvasId, title, doc };
          const store = surfaceId === 'cowork' ? useCoworkStore.getState() : useChatStore.getState();
          store.addCanvasArtifact(chatId, { ...payload, createdAt: Date.now() });
          store.attachCanvasToLastAssistant(chatId, payload);
        } else if (!chatId) {
          console.warn(`[${surfaceId}] canvas event fired but chatId is empty — chip won't attach`);
        }

        sendFeatureAdoptionEvent({ feature: 'canvas', surface: surfaceId });
      } catch (e) {
        console.error(`[${surfaceId}] Canvas event error:`, e);
      }
    },
    [surfaceId, pushCanvas, setCanvasOpen],
  );
}
