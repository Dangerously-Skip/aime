"use client";

import { useAppStore, type Surface } from "@/stores/app-store";
import { ChatSurface } from "@/components/surfaces/chat/chat-surface";
import { CoworkSurface } from "@/components/surfaces/cowork/cowork-surface";
import { CodeSurface } from "@/components/surfaces/code/code-surface";
import { BrowserSurface } from "@/components/surfaces/browser/browser-surface";

const SURFACE_COMPONENTS: Record<Surface, React.ComponentType> = {
  chat: ChatSurface,
  cowork: CoworkSurface,
  code: CodeSurface,
  browser: BrowserSurface,
};

/**
 * All surfaces are mounted simultaneously and shown/hidden via CSS.
 * This preserves scroll position, input state, and streaming state
 * when switching tabs.
 */
export function SurfaceRouter() {
  const activeSurface = useAppStore((s) => s.activeSurface);

  return (
    <>
      {(Object.entries(SURFACE_COMPONENTS) as [Surface, React.ComponentType][]).map(
        ([id, Component]) => (
          <div
            key={id}
            className="absolute inset-0"
            style={{ display: activeSurface === id ? "block" : "none" }}
          >
            <Component />
          </div>
        )
      )}
    </>
  );
}
