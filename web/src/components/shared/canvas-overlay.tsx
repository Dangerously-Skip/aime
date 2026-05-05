"use client";

import { useEffect, useRef } from "react";
import { CanvasPanel } from "./canvas-panel";
import { useCanvasStore } from "@/stores/canvas-store";
import { useAppStore } from "@/stores/app-store";
import { dispatchCanvasToolCall } from "@/lib/canvas/dispatch";
import type { A2UIAction } from "@/lib/a2ui/types";

interface CanvasOverlayProps {
  /** Surface this overlay belongs to. Drives store keys + dispatch surface. */
  surfaceId: "chat" | "cowork";
  /** Active conversation in this surface. Canvas closes when it changes. */
  conversationId: string;
}

/**
 * Single overlay that owns all canvas presentation + lifecycle for a surface.
 * Surfaces just render `<CanvasOverlay surfaceId={...} conversationId={chatId} />`
 * and call `useCanvasSseHandler` from their SSE switch.
 */
export function CanvasOverlay({ surfaceId, conversationId }: CanvasOverlayProps) {
  const canvasDoc = useCanvasStore((s) => s.canvasDoc);
  const canvasOpen = useCanvasStore((s) => !!s.openSurfaces[surfaceId]);
  const canvasHistoryIndex = useCanvasStore((s) => s.historyIndex);
  const canvasHistoryLength = useCanvasStore((s) => s.history.length);
  const goBackCanvas = useCanvasStore((s) => s.goBack);
  const goForwardCanvas = useCanvasStore((s) => s.goForward);
  const clearCanvas = useCanvasStore((s) => s.clearCanvas);
  const setCanvasOpen = useCanvasStore((s) => s.setOpen);
  // Subscribe to activeSurface so we re-render when switching back; this
  // gives the panel a chance to recompute its layout (parent went from
  // display:none to display:block, which can leave absolute children in a
  // stale layout state if nothing re-renders).
  const activeSurface = useAppStore((s) => s.activeSurface);
  // The variable is read intentionally to keep the dep — no further use.
  void activeSurface;

  // Close + clear when conversation changes within this surface, so the
  // previous conversation's canvas doesn't leak. Guarded with a ref so
  // transient empty conversation IDs (during mount churn / resize) don't
  // trash state.
  const lastIdRef = useRef<string>("");
  useEffect(() => {
    if (!conversationId) return;
    if (lastIdRef.current === conversationId) return;
    const isFirstSetting = lastIdRef.current === "";
    lastIdRef.current = conversationId;
    // Don't clear on the very first mount — there's no previous conversation
    // to leak from, and clearing here would close a canvas the agent just
    // streamed.
    if (isFirstSetting) return;
    clearCanvas();
    setCanvasOpen(surfaceId, false);
  }, [conversationId, surfaceId, clearCanvas, setCanvasOpen]);

  return (
    <CanvasPanel
      open={canvasOpen}
      doc={canvasDoc}
      onClose={() => setCanvasOpen(surfaceId, false)}
      onBack={goBackCanvas}
      onForward={goForwardCanvas}
      onClear={clearCanvas}
      canGoBack={canvasHistoryIndex > 0}
      canGoForward={canvasHistoryIndex < canvasHistoryLength - 1}
      surface={surfaceId}
      conversationId={conversationId}
      onAction={(action: A2UIAction) => {
        if (action.type === "tool-call") {
          dispatchCanvasToolCall(action, { surfaceId }).catch((err) =>
            console.error("[canvas] tool-call failed:", err),
          );
        }
      }}
    />
  );
}
