'use client';

import { useCallback } from 'react';
import { useCanvasStore } from '@/stores/canvas-store';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { sendFeatureAdoptionEvent } from '@/lib/telemetry/events';
import type { A2UIDocument } from '@/lib/a2ui/types';

type SurfaceId = 'chat' | 'cowork';

/**
 * One canvas SSE handler shared by both surfaces. Each surface used to inline
 * the same five state mutations (push, open, addArtifact, attachToMessage,
 * telemetry). Drift between them caused most of the canvas-related layout bugs.
 *
 * Usage in a surface's SSE switch:
 *
 *     const onCanvasEvent = useCanvasSseHandler('chat', chatId);
 *     // ...
 *     case 'canvas': onCanvasEvent(event); break;
 */
export function useCanvasSseHandler(surfaceId: SurfaceId, chatId: string) {
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const setCanvasOpen = useCanvasStore((s) => s.setOpen);

  return useCallback(
    (event: { doc?: unknown }) => {
      try {
        const doc = event.doc as A2UIDocument | undefined;
        console.log(`[${surfaceId}] canvas event received`, { hasDoc: !!doc, hasComponents: !!doc?.components, chatId });
        if (!doc || !doc.components) {
          console.warn(`[${surfaceId}] canvas event dropped — doc malformed`, doc);
          return;
        }

        pushCanvas(surfaceId, doc);
        setCanvasOpen(surfaceId, true);

        if (chatId) {
          const canvasId = crypto.randomUUID();
          const title = doc.title || 'Canvas';
          const payload = { id: canvasId, title, doc };

          if (surfaceId === 'cowork') {
            const c = useCoworkStore.getState();
            c.addCanvasArtifact(chatId, { ...payload, createdAt: Date.now() });
            c.attachCanvasToLastAssistant(chatId, payload);
          } else {
            const c = useChatStore.getState();
            c.addCanvasArtifact(chatId, { ...payload, createdAt: Date.now() });
            c.attachCanvasToLastAssistant(chatId, payload);
          }
          console.log(`[${surfaceId}] canvas chip attached + artifact saved`, { canvasId, title });
        } else {
          console.warn(`[${surfaceId}] canvas event fired but chatId is empty — chip won't attach`);
        }

        sendFeatureAdoptionEvent({ feature: 'canvas', surface: surfaceId });
      } catch (e) {
        console.error(`[${surfaceId}] Canvas event error:`, e);
      }
    },
    [surfaceId, chatId, pushCanvas, setCanvasOpen],
  );
}
