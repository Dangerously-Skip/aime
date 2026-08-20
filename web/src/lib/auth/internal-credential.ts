/**
 * The credential our OWN inference clients need to reach our OWN proxy.
 *
 * WHAT BROKE. `execution.ts` builds a self-referential base URL —
 * `${origin}/api/llm-proxy/<provider>/<upstream>` — so a BYOK provider's traffic
 * goes out through this app's own API route. Authenticating `/api/*`
 * (`src/proxy.ts`) therefore 401'd our own inference, and the first symptom was
 * a browser task that produced nothing at all:
 *
 *   [BROWSER-TURN] Error: 401 {"error":"Missing or invalid local API credential."}
 *
 * The blast radius was not the browser. `claude-provider.ts` sets
 * ANTHROPIC_BASE_URL for the Agent SDK SUBPROCESS from the same builder, so
 * every non-Anthropic provider was broken on every surface — Chat, Cowork, Code
 * and the harness — for anyone not talking to Anthropic directly. Anthropic-key
 * users saw nothing wrong, which is why it survived a full suite and a merge.
 *
 * WHY NOT AN EXEMPTION. The obvious fix is to skip auth for `/api/llm-proxy`
 * and lean on the Origin check. It would work: a page on another site sends
 * `Origin:` and is refused. But the endpoint spends the user's money, an
 * exemption is exactly the shape that quietly becomes a hole, and the CLAUDE.md
 * rule this auth was written under is that it FAILS CLOSED. So the credential
 * travels with the request instead.
 *
 * TWO CALLERS, TWO MECHANISMS, ONE TOKEN:
 *
 *   in-process (`turn-client`) -> `defaultHeaders: { Authorization: Bearer … }`
 *   subprocess (Agent SDK)     -> `ANTHROPIC_AUTH_TOKEN`, which the Anthropic
 *                                 SDK sends as `Authorization: Bearer …`
 *
 * The subprocess is the reason this is not simply a header at one call site: we
 * do not construct its HTTP client and can only reach it through environment.
 * Overriding its auth header costs nothing, because the proxy authenticates
 * UPSTREAM with the provider credential it holds — the SDK's own key never
 * needed to reach the provider through this path.
 */

/** True when this base URL points back at us rather than at a real provider. */
export function isSelfProxy(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).pathname.includes('/api/llm-proxy/');
  } catch {
    return false;
  }
}

/** The local API token, or null when the server was started without one. */
export function internalToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const t = env.AIME_API_TOKEN;
  return typeof t === 'string' && t.length >= 16 ? t : null;
}

/**
 * Headers for an in-process client whose base URL is our own proxy.
 *
 * Empty for a real provider — sending our local token to Anthropic or
 * OpenRouter would be a credential leak, not merely useless.
 */
export function internalAuthHeaders(
  baseUrl: string | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  if (!isSelfProxy(baseUrl)) return {};
  const token = internalToken(env);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Environment additions for the Agent SDK subprocess.
 *
 * Same guard: only when the base URL is ours.
 */
export function internalAuthEnv(
  baseUrl: string | undefined,
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  if (!isSelfProxy(baseUrl)) return {};
  const token = internalToken(env);
  return token ? { ANTHROPIC_AUTH_TOKEN: token } : {};
}
