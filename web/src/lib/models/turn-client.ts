import 'server-only';
// ^ Constructs AWS/GCP-signing clients and reads credentials. Never a client bundle.

/**
 * Build the right Anthropic HTTP client for a resolved execution target.
 *
 * ## Why this exists
 *
 * Most of the app talks to models through the Claude Agent SDK, which spawns the
 * Claude Code CLI as a subprocess. Bedrock and Vertex support live INSIDE that
 * binary: you set `CLAUDE_CODE_USE_BEDROCK=1` and AWS credentials in the
 * subprocess environment (see `claude-provider.ts` and `bedrock-env.ts`) and the
 * CLI does the SigV4 signing itself.
 *
 * The browser surface cannot use that path — the Agent SDK owns its tool loop
 * and will not accept caller-supplied schemas executed client-side against a
 * live webview — so it calls the raw Messages API with an in-process HTTP
 * client. That client has no subprocess and therefore no environment to
 * configure, which is why setting `CLAUDE_CODE_USE_BEDROCK` did nothing for it
 * and a Bedrock user simply got "no API key configured".
 *
 * The fix is small because after construction all three clients expose the SAME
 * `messages.stream` surface. Only the constructor and the model-id spelling
 * differ, and both are contained here.
 *
 * The backend is chosen from `exec.env` alone — the same environment the Agent
 * SDK subprocess would receive. A caller whose SERVER is configured for Bedrock
 * but who added no provider in Settings has no `exec.env`, so the route fills it
 * from `getBedrockEnv()` before calling in. One input, no second "ambient" flag
 * that could disagree with it.
 */
import Anthropic from '@anthropic-ai/sdk';
import { internalAuthHeaders } from '@/lib/auth/internal-credential';
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import type { ResolvedExecution } from './execution';

/**
 * The subset every client shares — all a turn needs.
 *
 * Structural on purpose: `AnthropicVertex` narrows its own `messages` resource
 * (no `batches`), so `Pick<Anthropic, 'messages'>` does not accept it. Naming
 * only `stream` keeps all three interchangeable and says exactly what this
 * module promises its caller.
 */
export interface TurnClient {
  messages: Pick<Anthropic['messages'], 'stream'>;
}

export interface TurnTarget {
  client: TurnClient;
  /** The model id as THIS backend spells it. */
  model: string;
  /** For logs and errors — never inferred by callers from the client type. */
  backend: 'anthropic' | 'bedrock' | 'vertex';
}

/**
 * Bedrock namespaces Anthropic models: `anthropic.claude-opus-5`.
 *
 * Guarded against double-prefixing, because a user can pin an already-namespaced
 * id from their own catalog and `anthropic.anthropic.claude-…` is a 404 that
 * reads like a model that does not exist.
 */
export function toBedrockModelId(model: string): string {
  return model.startsWith('anthropic.') ? model : `anthropic.${model}`;
}

/**
 * Vertex takes the bare first-party id for current-generation models, so no
 * translation. Named anyway so the asymmetry with Bedrock is explicit rather
 * than an omission someone later "fixes".
 */
export function toVertexModelId(model: string): string {
  return model;
}

export interface CreateTurnClientOptions {
  /** From `resolveExecution` — carries the Bedrock/Vertex env when configured. */
  exec: ResolvedExecution;
  /** Resolved key for the plain Anthropic path. */
  apiKey?: string;
  /** The model id in first-party spelling. */
  model: string;
}

export function createTurnClient(opts: CreateTurnClientOptions): TurnTarget {
  const env = opts.exec.env ?? {};

  if (env.CLAUDE_CODE_USE_BEDROCK) {
    return {
      backend: 'bedrock',
      model: toBedrockModelId(opts.model),
      client: new AnthropicBedrockMantle({
        // Every field is optional: with none of them the SDK falls back to the
        // default AWS credential chain (profile, instance role, SSO), which is
        // exactly what the Agent SDK path gets today via the subprocess env.
        ...(env.AWS_REGION ? { awsRegion: env.AWS_REGION } : {}),
        ...(env.AWS_ACCESS_KEY_ID ? { awsAccessKey: env.AWS_ACCESS_KEY_ID } : {}),
        ...(env.AWS_SECRET_ACCESS_KEY ? { awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY } : {}),
        ...(env.AWS_SESSION_TOKEN ? { awsSessionToken: env.AWS_SESSION_TOKEN } : {}),
      }),
    };
  }

  if (env.CLAUDE_CODE_USE_VERTEX) {
    return {
      backend: 'vertex',
      model: toVertexModelId(opts.model),
      client: new AnthropicVertex({
        ...(env.CLOUD_ML_REGION ? { region: env.CLOUD_ML_REGION } : {}),
        ...(env.ANTHROPIC_VERTEX_PROJECT_ID
          ? { projectId: env.ANTHROPIC_VERTEX_PROJECT_ID }
          : {}),
      }),
    };
  }

  return {
    backend: 'anthropic',
    model: opts.model,
    client: new Anthropic({
      apiKey: opts.apiKey ?? '',
      ...(opts.exec.baseUrl ? { baseURL: opts.exec.baseUrl } : {}),
      /*
       * When the base URL is this app's own llm-proxy, the request has to carry
       * the local API credential or `src/proxy.ts` refuses it — which is how a
       * browser task came back empty with a 401 nobody saw. Empty for a real
       * provider: sending our local token to Anthropic would be a leak.
       */
      defaultHeaders: internalAuthHeaders(opts.exec.baseUrl),
    }),
  };
}
