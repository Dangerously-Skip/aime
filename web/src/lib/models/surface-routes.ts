/**
 * Per-surface default routing: which (capability, tier) each surface asks for
 * when the user hasn't pinned a specific model. The registry resolves this to a
 * concrete model, so a surface expresses *intent* ("premium coding") rather than
 * a hardcoded model name.
 *
 * Defaults reproduce today's hardcoded per-surface models exactly against the
 * default Claude registry — cowork `code/smort` → opus, everything else → sonnet
 * — so this is a no-behaviour-change drop-in. Client-safe (types only), so both
 * the surfaces and the API route can share it as the single source of truth.
 */
import type { Capability, Tier } from './types';

export interface SurfaceRoute {
  capability: Capability;
  tier: Tier;
}

/** Fallback for an unknown//new surface id. */
export const DEFAULT_SURFACE_ROUTE: SurfaceRoute = { capability: 'chat', tier: 'good' };

export const SURFACE_ROUTES: Record<string, SurfaceRoute> = {
  // Conversational surfaces → chat capability.
  chat: { capability: 'chat', tier: 'good' }, // → sonnet
  assistant: { capability: 'chat', tier: 'good' }, // → sonnet
  // Tool-driven surfaces → code capability. Cowork runs premium by default,
  // matching its previous hardcoded 'opus'.
  cowork: { capability: 'code', tier: 'smort' }, // → opus
  code: { capability: 'code', tier: 'good' }, // → sonnet
  /*
     Browser is tool-driven, and only became so recently.

     It sat on `chat/good` because that described it accurately: a hand-rolled
     ReAct loop with nineteen browser tools and nothing else — no MCP, no
     connectors, no files, no memory (DR-22). It now runs the same agent as Code,
     over the same toolset plus the browser relay, so it belongs on the same
     side of the split this table's own comment draws.

     The resolved model is unchanged against the default Claude registry
     (code/good → sonnet, exactly as chat/good did), so this is not a quiet
     upgrade. What changes is WHICH SLOT of the user's tier grid governs it: a
     user who set a cheap conversational model for chat is no longer given it
     for a surface that drives a browser and writes files.
  */
  browser: { capability: 'code', tier: 'good' }, // → sonnet
};

/**
 * The (capability, tier) a surface should request. A user tier override for that
 * surface (from settings) replaces the default tier; the capability is a
 * property of the surface and is never overridden.
 */
export function getSurfaceRoute(
  surfaceId: string,
  tierOverrides?: Record<string, Tier> | null,
): SurfaceRoute {
  const base = SURFACE_ROUTES[surfaceId] ?? DEFAULT_SURFACE_ROUTE;
  const override = tierOverrides?.[surfaceId];
  return override ? { capability: base.capability, tier: override } : base;
}
