"use client";

import { useEffect, useRef, useState } from "react";
import { CanvasPanel } from "./canvas-panel";
import { useCanvasStore } from "@/stores/canvas-store";
import { useAppStore } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settings-store";
import { dispatchCanvasToolCall } from "@/lib/canvas/dispatch";
import { refreshCanvasDoc } from "@/lib/canvas/dispatch";
import type { A2UIAction, A2UIDocument } from "@/lib/a2ui/types";

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
  // Per-surface state: each surface has its own current doc, history,
  // and open flag. Switching surfaces no longer leaks canvases.
  const surfaceState = useCanvasStore((s) => s.bySurface[surfaceId]);
  const canvasDoc = surfaceState?.doc ?? null;
  const canvasOpen = !!surfaceState?.open;
  const canvasHistoryIndex = surfaceState?.historyIndex ?? -1;
  const canvasHistoryLength = surfaceState?.history.length ?? 0;
  const goBackStore = useCanvasStore((s) => s.goBack);
  const goForwardStore = useCanvasStore((s) => s.goForward);
  const clearStore = useCanvasStore((s) => s.clearCanvas);
  const setOpenStore = useCanvasStore((s) => s.setOpen);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Subscribe to activeSurface so we re-render when switching back; this
  // gives the panel a chance to recompute its layout (parent went from
  // display:none to display:block, which can leave absolute children in a
  // stale layout state if nothing re-renders).
  const activeSurface = useAppStore((s) => s.activeSurface);
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
    clearStore(surfaceId);
    setOpenStore(surfaceId, false);
  }, [conversationId, surfaceId, clearStore, setOpenStore]);

  return (
    <CanvasPanel
      open={canvasOpen}
      doc={canvasDoc}
      onClose={() => setOpenStore(surfaceId, false)}
      onBack={() => goBackStore(surfaceId)}
      onForward={() => goForwardStore(surfaceId)}
      onClear={() => clearStore(surfaceId)}
      canGoBack={canvasHistoryIndex > 0}
      canGoForward={canvasHistoryIndex < canvasHistoryLength - 1}
      surface={surfaceId}
      conversationId={conversationId}
      isRefreshing={isRefreshing}
      onAction={(action: A2UIAction) => {
        if (action.type === "tool-call") {
          // Snapshot the refreshPrompt before dispatching — `canvasDoc` is
          // closed over here, so this stays correct even if state changes.
          const refreshPrompt = canvasDoc?.refreshPrompt;
          console.log("[canvas-overlay] tool-call fired", { tool: action.tool, hasRefreshPrompt: !!refreshPrompt, refreshPrompt, hasApiKey: !!nibGatewayApiKey, docHasRefreshPrompt: !!(canvasDoc as A2UIDocument | null)?.refreshPrompt });
          dispatchCanvasToolCall(action, { surfaceId, apiKey: nibGatewayApiKey })
            .then(async (result) => {
              console.log("[canvas-overlay] dispatch resolved", { resultPreview: String(result).slice(0, 120), willRefresh: !!refreshPrompt });
              if (!refreshPrompt) return;
              setIsRefreshing(true);
              try {
                const fresh = await refreshCanvasDoc(refreshPrompt, { surfaceId, apiKey: nibGatewayApiKey });
                console.log("[canvas-overlay] refresh returned", { hasFresh: !!fresh, components: fresh?.components?.length });
                if (fresh) {
                  // Preserve refreshPrompt on the new doc so the next action
                  // can refresh too (the agent should do this, but belt-and-braces).
                  const next: A2UIDocument = fresh.refreshPrompt
                    ? fresh
                    : { ...fresh, refreshPrompt };
                  pushCanvas(surfaceId, next);
                }
              } catch (err) {
                console.error("[canvas] refresh failed:", err);
              } finally {
                setIsRefreshing(false);
              }
            })
            .catch((err) => console.error("[canvas] tool-call failed:", err));
        }
      }}
    />
  );
}
