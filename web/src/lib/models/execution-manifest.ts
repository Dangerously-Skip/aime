import type { ProviderExecConfig } from './execution';
import type { Capability } from './types';

/**
 * The tier grid's decision, written where the SERVER can read it.
 *
 * WHAT THIS SOLVES. Scheduled work runs with no request: the widget scheduler
 * ticks every 60s inside the Next server, deliberately so a due widget refreshes
 * "with no window at all". It therefore has no access to the user's provider
 * configuration, which lives client-side in the provider store and the tier
 * grid — and so `refresh-service.ts` fell back to a hardcoded `'haiku'` and
 * `getServerAnthropicKey()`. On an account with no Anthropic key that is not a
 * degraded refresh, it is no refresh at all, once per tick, silently.
 *
 * That is the third instance of one bug this week — the memory extractor and the
 * search carrier were the others — and all three have the same root: code that
 * names a model without resolving one.
 *
 * WHAT IS AND IS NOT IN HERE. Not credentials. Those are already server-side, in
 * an encrypted store keyed by provider id, and the chat routes already read
 * them. The only thing missing was the SELECTION — which provider and model the
 * user chose for a capability and tier — and a selection is ordinary
 * configuration, not a secret. `execution-manifest.no-secrets.test.ts` holds
 * that line rather than trusting it.
 *
 * WHY A PROJECTION AND NOT A SECOND SOURCE OF TRUTH. `resolveSendRoute` is the
 * one place a model is chosen, and this codebase has already paid for having
 * four. This file stores that function's OUTPUT so a process that cannot run it
 * can still obey it. It is a cache, and it is written from the same place that
 * persists a provider change, so it cannot drift silently.
 *
 * AND WHEN IT IS ABSENT, CALLERS SKIP. A missing entry means the user has not
 * configured that slot, and the honest response is to do nothing — the same
 * conclusion the extractor reached the hard way. Guessing is what produced a 400
 * per turn for every OpenRouter user.
 */

/** One resolved route: exactly what `resolveSendRoute` returns. */
export interface ManifestRoute {
  model: string;
  providerConfig?: ProviderExecConfig;
}

export interface ExecutionManifest {
  version: 1;
  /** ISO, for a human reading the file and for staleness diagnosis. */
  updatedAt: string;
  /** Keyed `capability/tier`, e.g. `chat/good`. */
  routes: Record<string, ManifestRoute>;
}

export const MANIFEST_VERSION = 1 as const;
export const MANIFEST_FILENAME = 'execution-manifest.json';

/**
 * Keyed by CAPABILITY alone, because that is what the resolver takes.
 *
 * `SURFACE_ROUTES` carries a tier per surface, but no surface passes it:
 * `resolveSendRoute(null, providers, { capability, tierModels, … })` has no
 * `tier` parameter, and folds the tier grid in itself. A `capability/tier` key
 * would therefore have a component that never varies the answer — a shape that
 * looks more precise than it is, and would send a reader looking for a
 * distinction the system does not currently make.
 *
 * If tier ever becomes a resolver input, this is the one function to change.
 */
export function manifestKey(capability: Capability | string): string {
  return String(capability);
}

export function emptyManifest(nowIso: string): ExecutionManifest {
  return { version: MANIFEST_VERSION, updatedAt: nowIso, routes: {} };
}

/**
 * Fields we refuse to persist, whatever a caller passes.
 *
 * The manifest is PLAIN JSON on disk, unlike the credential store. A provider
 * config that arrives carrying an `apiKey` — because some future caller built it
 * from a fuller object — must not be written through to a plaintext file. Named
 * and stripped rather than trusted, because the caller is the renderer and the
 * route that accepts this is unauthenticated on loopback.
 */
const FORBIDDEN_FIELDS = ['apiKey', 'api_key', 'token', 'secret', 'password', 'credential'];

/** Strip anything secret-shaped from a provider config before storing it. */
export function stripSecrets(config: unknown): ProviderExecConfig | undefined {
  if (!config || typeof config !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.some((f) => k.toLowerCase().includes(f.toLowerCase()))) continue;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') continue; // no nested structures; nothing needs them
    out[k] = v;
  }
  return typeof out.providerId === 'string' ? (out as unknown as ProviderExecConfig) : undefined;
}

/**
 * Parse a manifest read from disk.
 *
 * Validating rather than casting: this file is written by an unauthenticated
 * loopback route, and a malformed or hostile entry would otherwise choose the
 * model an unattended agent runs on. `null` for anything unusable — the caller
 * skips, and skipping is always safe.
 */
export function parseManifest(raw: unknown): ExecutionManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== MANIFEST_VERSION) return null;
  if (!o.routes || typeof o.routes !== 'object') return null;

  const routes: Record<string, ManifestRoute> = {};
  for (const [key, value] of Object.entries(o.routes as Record<string, unknown>)) {
    if (!/^[a-z0-9-]+$/i.test(key)) continue;
    if (!value || typeof value !== 'object') continue;
    const r = value as Record<string, unknown>;
    if (typeof r.model !== 'string' || !r.model.trim()) continue;
    routes[key] = { model: r.model, providerConfig: stripSecrets(r.providerConfig) };
  }

  return {
    version: MANIFEST_VERSION,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    routes,
  };
}

/** Build a manifest from resolved routes, dropping anything unusable. */
export function buildManifest(
  entries: Array<{ capability: string; model?: string | null; providerConfig?: unknown }>,
  nowIso: string,
): ExecutionManifest {
  const routes: Record<string, ManifestRoute> = {};
  for (const e of entries) {
    if (!e.model || !e.model.trim()) continue; // an unresolved slot is not a route
    routes[manifestKey(e.capability)] = {
      model: e.model,
      providerConfig: stripSecrets(e.providerConfig),
    };
  }
  return { version: MANIFEST_VERSION, updatedAt: nowIso, routes };
}

/**
 * The route for a capability and tier, or null.
 *
 * NULL IS A FIRST-CLASS ANSWER and callers must treat it as "do nothing". It
 * means the user has not configured this slot, and the alternative — a default —
 * is exactly the hardcoded `'haiku'` this file exists to delete.
 */
export function resolveFromManifest(
  manifest: ExecutionManifest | null,
  capability: Capability | string,
): ManifestRoute | null {
  if (!manifest) return null;
  return manifest.routes[manifestKey(capability)] ?? null;
}
