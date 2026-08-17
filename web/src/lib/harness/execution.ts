import type { ProviderExecConfig } from '@/lib/models/execution';

/**
 * Resolve which model a harness session runs on, and with what credentials.
 *
 * WHY THIS EXISTS — found by running one. The first real goal run failed at the
 * planner with "Not logged in · Please run /login", because the harness routes
 * called `provider.query` with `surfaceConfig.model` and no key at all. Every
 * other path resolves a key through `resolveExecution`; these two did not, so
 * the whole feature could never have worked outside an environment with
 * `ANTHROPIC_API_KEY` already in the process.
 *
 * The second problem is the one that would have outlived the first. A surface
 * that resolves its own model instead of taking the client's
 * `resolveSendRoute` answer does not run "a slightly different model" — it
 * resolves against the BUILT-IN Anthropic registry and then demands an Anthropic
 * key, so for an OpenRouter-only user that surface is simply dead while every
 * other one works. The browser surface shipped exactly that, for months. The
 * harness had reintroduced it: `send-route-coverage.test.ts` derives its sets
 * from the SURFACE list, and a route is not a surface, so nothing caught it.
 *
 * So the client sends the route it already resolved — `model` and
 * `providerConfig` — and this turns that into what the provider needs. It is
 * deliberately the same call the chat route makes, rather than a second way of
 * answering the same question.
 */
export interface HarnessRoute {
  model?: string | null;
  providerConfig?: ProviderExecConfig | null;
  /** A transient key from the request, for a provider with no stored credential. */
  apiKey?: string | null;
}

export interface HarnessExecution {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  providerEnv?: Record<string, string>;
}

/**
 * `fallbackModel` is the surface default and the LAST resort, not the norm. If
 * it is doing the work, the client failed to send a route and the run is about
 * to ignore the user's tier grid.
 */
export async function resolveHarnessExecution(
  route: HarnessRoute,
  fallbackModel: string,
  shimOrigin: string,
): Promise<HarnessExecution> {
  const { resolveExecution } = await import('@/lib/models/execution');
  const { getCredentialStore } = await import('@/lib/models/credentials');

  const exec = await resolveExecution({
    providerConfig: route.providerConfig ?? null,
    requestApiKey: route.apiKey ?? null,
    shimOrigin,
    // Every stored field, not just the key: Bedrock and Vertex are driven by an
    // environment built from region/project/credentials.
    loadFields: async (id) => {
      try {
        return await getCredentialStore().get(id);
      } catch {
        return undefined;
      }
    },
    loadKey: async (id) => {
      try {
        return await getCredentialStore().getField(id, 'apiKey');
      } catch {
        // No AIME_CRED_KEY, or an unreadable store — fall back to the request.
        return undefined;
      }
    },
  });

  return {
    model: route.model || fallbackModel,
    apiKey: exec.apiKey,
    baseUrl: exec.baseUrl,
    providerEnv: exec.env,
  };
}
