"use client";

import { useAppStore, type Surface } from "@/stores/app-store";
import { ChatSurface } from "@/components/surfaces/chat/chat-surface";
import { CoworkSurface } from "@/components/surfaces/cowork/cowork-surface";
import { CodeSurface } from "@/components/surfaces/code/code-surface";
import { BrowserSurface } from "@/components/surfaces/browser/browser-surface";
import { AssistantSurface } from "@/components/surfaces/assistant/assistant-surface";
import { VoiceScope } from "@/lib/voice/voice-scope";

const SURFACE_COMPONENTS: Record<Surface, React.ComponentType> = {
  chat: ChatSurface,
  cowork: CoworkSurface,
  code: CodeSurface,
  browser: BrowserSurface,
  assistant: AssistantSurface,
};

/**
 * All surfaces are mounted simultaneously and shown/hidden via CSS.
 * This preserves scroll position, input state, and streaming state
 * when switching tabs.
 *
 * Because everything is mounted, "the current surface" is not something a
 * surface can work out for itself — a hidden surface still runs its effects. The
 * one comparison against `activeSurface` therefore lives here, in the loop that
 * already decides visibility, and is published to descendants through
 * `VoiceScope`. Push-to-talk originally duplicated that comparison inside two
 * surfaces and each one's copy fought over the OS hotkey.
 */
export function SurfaceRouter() {
  const activeSurface = useAppStore((s) => s.activeSurface);

  return (
    <>
      {(Object.entries(SURFACE_COMPONENTS) as [Surface, React.ComponentType][]).map(
        ([id, Component]) => (
          <VoiceScope key={id} id={id} active={activeSurface === id}>
            <div
              className="absolute inset-0"
              style={{ display: activeSurface === id ? "block" : "none" }}
            >
              <Component />
            </div>
          </VoiceScope>
        )
      )}
    </>
  );
}
