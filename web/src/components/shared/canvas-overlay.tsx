"use client";

import { useState } from "react";
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
  // Per-surface state. The store also stamps each canvas with the conversation
  // that produced it; we gate rendering on that ID to stop bleed-through when
  // switching chats — the previous mount-ref guard missed this on
  // surface-switch / remount sequences.
  const surfaceState = useCanvasStore((s) => s.bySurface[surfaceId]);
  const docMatches = !!surfaceState?.doc
    && (surfaceState.conversationId === null
      || surfaceState.conversationId === conversationId);
  const canvasDoc = docMatches ? (surfaceState?.doc ?? null) : null;
  const canvasOpen = docMatches && !!surfaceState?.open;
  const canvasHistoryIndex = docMatches ? (surfaceState?.historyIndex ?? -1) : -1;
  const canvasHistoryLength = docMatches ? (surfaceState?.history.length ?? 0) : 0;
  const goBackStore = useCanvasStore((s) => s.goBack);
  const goForwardStore = useCanvasStore((s) => s.goForward);
  const clearStore = useCanvasStore((s) => s.clearCanvas);
  const setOpenStore = useCanvasStore((s) => s.setOpen);
  const pushCanvas = useCanvasStore((s) => s.pushCanvas);
  const nibGatewayApiKey = useSettingsStore((s) => s.nibGatewayApiKey);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Subscribe to activeSurface so we re-render when switching back.
  const activeSurface = useAppStore((s) => s.activeSurface);
  void activeSurface;

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
                  pushCanvas(surfaceId, next, conversationId || null);
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
