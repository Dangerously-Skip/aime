'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { releaseTranscriptTarget, setTranscriptTarget } from './voice-session';

/**
 * Which composer a finished transcript belongs to.
 *
 * Every surface is mounted at once and hidden with CSS (see `surface-router`),
 * so "the composer" is ambiguous unless something says which one is on screen.
 * That decision belongs to the shell — it is the only place that knows the
 * active surface — and putting it here means a surface never has to compare its
 * own id against the active one. The original push-to-talk bug was exactly that
 * comparison, copy-pasted into two surfaces; a third copy would have re-created
 * it.
 *
 * A surface therefore declares only its identity (via this provider, mounted by
 * the router) and registers a sink (via `useVoiceInput`). Registration is
 * idempotent and harmless; only the shell nominates a target.
 */
const VoiceScopeContext = createContext<string | null>(null);

/** The enclosing scope id, or null for a consumer mounted outside the surfaces. */
export function useVoiceScopeId(): string | null {
  return useContext(VoiceScopeContext);
}

interface VoiceScopeProps {
  /** Surface id. */
  id: string;
  /** Whether this scope is the one the user is looking at. */
  active: boolean;
  children: ReactNode;
}

export function VoiceScope({ id, active, children }: VoiceScopeProps) {
  useEffect(() => {
    if (!active) return;
    setTranscriptTarget(id);
    // React runs every pending cleanup before any new effect, so on a surface
    // switch the outgoing scope clears the target before the incoming one sets
    // it — the order that leaves exactly one target, never zero.
    return () => releaseTranscriptTarget(id);
  }, [id, active]);

  return <VoiceScopeContext.Provider value={id}>{children}</VoiceScopeContext.Provider>;
}
