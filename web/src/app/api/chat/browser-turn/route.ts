import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createSSEStream } from '@/lib/sse';
import type { ProviderExecConfig } from '@/lib/models/execution';
import type { Capability, Tier } from '@/lib/models/types';

export const runtime = 'nodejs';

/**
 * SDK model aliases → concrete Messages API model ids.
 *
 * Every other surface hands `opus`/`sonnet`/`haiku` to the Agent SDK, which
 * resolves them itself. The raw Messages API does not accept an alias, so this
 * route has to resolve it — and the registry cannot answer: its `driverModel` IS
 * the alias, and its `id` is a registry-internal key (`claude-opus`). Neither is
 * an API model id.
 *
 * These were pinned to Claude 4 (`claude-sonnet-4-20250514` and siblings), so the
 * browser surface has been running a deprecated generation while every other
 * surface got current models for free by going through the SDK. That is the cost
 * of a second inference path, and it is the reason this route now resolves
 * through the registry rather than a hardcoded map of its own.
 */
const ALIAS_TO_MODEL_ID: Record<string, string> = {
  fable: 'claude-fable-5',
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

/** An alias resolves; anything else is assumed to be a concrete id already. */
function toApiModelId(model: string): string {
  return ALIAS_TO_MODEL_ID[model] ?? model;
}

/**
 * Single-turn streaming endpoint for the browser agent.
 *
 * Unlike the main /api/chat/[surfaceId] which runs a full agentic loop server-side,
 * this returns after ONE model turn. When the response includes tool_use blocks,
 * the client executes them in the webview and calls again with the results.
 *
 * ## Why this is not `provider.query()`
 *
 * The obvious consolidation — "just call getProvider() with maxTurns: 1" — does
 * not fit, and it is worth writing down so nobody re-derives it. `QueryParams`
 * takes a single `prompt: string` and has no field for caller-supplied tool
 * schemas, because the Agent SDK owns its own tool loop. The browser agent needs
 * the opposite shape: a message ARRAY carrying tool_result blocks, 17 tool
 * schemas defined client-side, and `tool_use` handed back to the CLIENT to
 * execute against a live webview. That is a raw Messages API call by nature.
 *
 * What was genuinely wrong was everything AROUND the call: a hardcoded 3-entry
 * model map, and a key that had to come from the browser. Both are now resolved
 * server-side through the same registry and credential store as every other
 * surface, so this route no longer has its own idea of what a model is or where
 * a key comes from.
 *
 * POST /api/chat/browser-turn
 * Body: { messages, model, tools, system, apiKey?, capability?, tier?, providerConfig? }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    messages,
    model = null,
    tools,
    system,
    apiKey: userApiKey = null,
    capability = null,
    tier = null,
    providerConfig = null,
  } = body as {
    messages: Anthropic.MessageParam[];
    model?: string | null;
    tools?: Anthropic.Tool[];
    system?: string;
    apiKey?: string | null;
    capability?: Capability | null;
    tier?: Tier | null;
    providerConfig?: ProviderExecConfig | null;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages array is required' }, { status: 400 });
  }

  // Whether the SERVER itself is set up for Bedrock. Needed before the registry
  // lookup, because it decides whether a Bedrock model is even offerable.
  const { isBedrockConfigured } = await import('@/lib/bedrock-env');
  const bedrockConfigured = isBedrockConfigured();

  // ── Model: the registry answers, not a map local to this route ──────────
  // Same shape as /api/chat/[surfaceId]: a pinned model wins, otherwise the
  // surface's (capability, tier) intent resolves against what is actually
  // available. `browser` has its own SURFACE_ROUTES entry, so this picks up a
  // per-surface tier preference like every other surface does.
  let effectiveModel = model;
  if (!effectiveModel) {
    const { resolveRoute, createDefaultRegistry } = await import('@/lib/models/registry');
    const { getSurfaceRoute } = await import('@/lib/models/surface-routes');
    const route = getSurfaceRoute('browser');
    const resolved = resolveRoute(
      createDefaultRegistry(),
      capability ?? route.capability,
      tier ?? route.tier,
      // Bedrock counts as available when the server is configured for it, the
      // same test /api/chat/[surfaceId] applies. Before this route could reach
      // Bedrock it had to exclude it, or it would offer a model it could not run.
      (p) => p.id === 'anthropic' || (p.id === 'bedrock' && bedrockConfigured),
    );
    effectiveModel = resolved?.model.driverModel ?? 'sonnet';
  }
  const resolvedModel = toApiModelId(effectiveModel);

  // ── Credentials: the server's stores, not the browser's ─────────────────
  // The key used to be REQUIRED from the client (`useSettingsStore.anthropicApiKey`),
  // which meant the surface was unusable for anyone whose credentials live
  // server-side — env, the encrypted credential store, or a user-added provider.
  const { resolveExecution } = await import('@/lib/models/execution');
  const exec = await resolveExecution({
    providerConfig,
    requestApiKey: userApiKey,
    // openai-compat providers route through the shim on this same server.
    shimOrigin: new URL(req.url).origin,
    loadFields: async (id) => {
      try {
        const { getCredentialStore } = await import('@/lib/models/credentials');
        return await getCredentialStore().get(id);
      } catch {
        return undefined;
      }
    },
    loadKey: async (id) => {
      try {
        const { getCredentialStore } = await import('@/lib/models/credentials');
        return await getCredentialStore().getField(id, 'apiKey');
      } catch {
        return undefined;
      }
    },
  });

  /**
   * Bedrock and Vertex used to be refused here with a 501: they are configured
   * as ENVIRONMENT for the Agent SDK subprocess, and a raw HTTP client has no
   * subprocess to configure. They work now because `createTurnClient` builds the
   * matching signing client instead — the Messages surface is identical after
   * construction, so nothing below this point changes.
   */
  // A server configured for Bedrock but with no provider added in Settings has
  // no `exec.env`; fill it from the same helper the Agent SDK path uses so both
  // read one source of truth.
  const { getBedrockEnv } = await import('@/lib/bedrock-env');
  const gatewayEnv =
    exec.env ?? (bedrockConfigured && !exec.apiKey ? getBedrockEnv() : undefined);

  // A user-added provider supplies its own base URL; Bedrock and Vertex carry
  // their own credentials; only the plain Anthropic path needs a key.
  const { getServerAnthropicKey } = await import('@/lib/models/credentials');
  const resolvedApiKey =
    exec.apiKey || (await getServerAnthropicKey()) || process.env.ANTHROPIC_API_KEY;
  const usesGatewayCreds = Boolean(gatewayEnv);
  if (!resolvedApiKey && !exec.baseUrl && !usesGatewayCreds) {
    return Response.json(
      {
        error:
          'No API key is configured. Add one in Settings → API Access, or set ANTHROPIC_API_KEY.',
      },
      { status: 400 },
    );
  }

  const { createTurnClient } = await import('@/lib/models/turn-client');
  let target;
  try {
    target = createTurnClient({
      exec: { ...exec, env: gatewayEnv },
      apiKey: resolvedApiKey,
      model: resolvedModel,
    });
  } catch (err) {
    // The Bedrock and Vertex clients THROW on incomplete configuration (a
    // missing region, unresolvable Google credentials). Surfacing that as a
    // clean 400 keeps a setup problem legible instead of a 500 with a stack.
    return Response.json(
      { error: `Could not reach the configured provider: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }
  const client = target.client;
  console.log(
    '[BROWSER-TURN]',
    target.backend,
    target.model,
    exec.baseUrl ? '(custom base URL)' : '',
  );
  const sse = createSSEStream();

  (async () => {
    const heartbeat = setInterval(() => sse.writeHeartbeat(), 15000);

    try {
      const streamParams: Anthropic.MessageCreateParams = {
        model: target.model,
        max_tokens: 4096,
        messages,
        stream: true,
      };

      if (system) {
        streamParams.system = system;
      }
      if (tools && tools.length > 0) {
        streamParams.tools = tools;
      }

      const stream = client.messages.stream(streamParams);

      let toolInputJson = '';

      stream.on('text', (text) => {
        sse.writeEvent({ type: 'text', content: text });
      });

      stream.on('inputJson', (_delta, snapshot) => {
        toolInputJson = snapshot as string;
      });

      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          let parsedInput = {};
          try {
            parsedInput = JSON.parse(toolInputJson);
          } catch {
            // Input may have been accumulated differently
            parsedInput = block.input as Record<string, unknown>;
          }
          sse.writeEvent({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: parsedInput,
          });
          // Reset for next tool
          toolInputJson = '';
        }
      });

      const finalMessage = await stream.finalMessage();

      // Send stop reason so client knows whether to continue the loop
      await sse.writeEvent({
        type: 'turn_complete',
        stop_reason: finalMessage.stop_reason,
        usage: finalMessage.usage,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[BROWSER-TURN] Error:', msg);
      await sse.writeEvent({ type: 'error', message: msg });
    } finally {
      clearInterval(heartbeat);
      await sse.close();
    }
  })();

  return sse.toResponse();
}
