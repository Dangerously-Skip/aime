import { internalToken, proxyToken } from '@/lib/auth/internal-credential';

/**
 * The provider key to forward upstream: `x-api-key` and nothing else.
 *
 * This used to fall back to the inbound `Authorization: Bearer`. On this route
 * that header is the LOCAL API token — our own clients put it there so
 * `src/proxy.ts` lets them in (see lib/auth/internal-credential) — so any
 * request without an x-api-key handed the per-launch token to OpenRouter or
 * whichever host the user configured. No key is sent instead; the upstream
 * answers 401, which is the honest failure. The internal token is refused even
 * as an x-api-key, in case a client ever puts it there.
 */
export function upstreamKey(
  req: Request,
  internal: string | null = internalToken(),
  scoped: string | null = proxyToken(),
): string | undefined {
  const xkey = req.headers.get('x-api-key')?.trim();
  if (!xkey) return undefined;
  if (internal && xkey === internal) return undefined;
  if (scoped && xkey === scoped) return undefined;
  return xkey;
}
