'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import { useVoiceScopeId } from '@/lib/voice/voice-scope';

/**
 * Whether the surface this component lives in is the one on screen.
 *
 * Every surface is mounted at once and hidden with CSS (see `surface-router`),
 * so a hidden surface keeps running its effects — including `window` keydown
 * listeners. Code's ⌘B/⌘J/⌘E fired while you typed in Chat, and Browser's ⌘⇧S
 * took a screenshot from Code. The router already publishes each surface's id
 * through `VoiceScope`; this compares it with the active surface so no surface
 * has to hardcode its own id.
 *
 * Outside any scope (a unit test, a component mounted in the shell) there is no
 * other surface to leak into, so it reports active.
 */
export function useSurfaceActive(): boolean {
  const scopeId = useVoiceScopeId();
  const activeSurface = useAppStore((s) => s.activeSurface);
  const sidebarMode = useAppStore((s) => s.sidebarMode);
  if (scopeId === null) return true;
  // Customize/Projects replace the surface area entirely.
  return activeSurface === scopeId && sidebarMode === 'history';
}

/**
 * A `window` keydown listener that only runs while this surface is on screen.
 *
 * The handler is read through a ref, so callers can pass an inline function
 * without re-subscribing on every render.
 */
export function useSurfaceKeydown(handler: (e: KeyboardEvent) => void): void {
  const active = useSurfaceActive();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => ref.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
