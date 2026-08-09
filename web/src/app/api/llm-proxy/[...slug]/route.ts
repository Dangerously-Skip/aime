import {
  anthropicToOpenAI,
  openAIToAnthropic,
  type AnthropicMessagesRequest,
} from '@/lib/models/llm-proxy/translate';
import { parseOpenAISSE, translateStream, serializeSSE } from '@/lib/models/llm-proxy/stream';

export const runtime = 'nodejs';

/**
 * The openai-compat translation shim (DR-11). The Agent SDK is pointed at
 *   /api/llm-proxy/<providerId>/<base64url(upstreamBaseUrl)>
 * and appends `/v1/messages`. We decode the upstream (an OpenAI-format base
 * URL), take the key from the SDK's x-api-key header, translate the Anthropic
 * request → OpenAI, forward it, and translate the response back.
 *
 * Local-first, single-user desktop app: the upstream is the user's own
 * configured provider. We still validate the scheme and require the request to
 * originate same-host (the shim is not meant to be a public open proxy).
 */

function anthropicError(
  status: number,
  message: string,
  type = 'invalid_request_error',
  headers?: Record<string, string>,
) {
  return Response.json({ type: 'error', error: { type, message } }, { status, headers });
}

/**
 * The status the CALLER should see for an upstream failure.
 *
 * Everything except 401/403 used to collapse to 502, which made four unrelated
 * problems indistinguishable: a malformed request, a model that no longer
 * exists, a rate limit, and the provider actually being down. Hours were spent
 * on "why is the proxy 502ing" with no way to tell which of those it was — the
 * upstream reason existed, in a response body that went to the SDK subprocess
 * and nowhere a human could read it.
 *
 * Passing 429 through matters beyond diagnosis. The Agent SDK backs off and
 * retries a rate limit, honouring `retry-after`; it cannot do that for a 502,
 * so masking one as the other converted a recoverable pause into a failed turn.
 *
 * 5xx stays 502: the upstream really is a bad gateway from the caller's side.
 */
function callerStatusFor(upstream: number): number {
  if (upstream >= 400 && upstream < 500) return upstream;
  return 502;
}

/** Rate-limit hints, which are useless to the SDK if we drop them. */
function retryHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of ['retry-after', 'x-ratelimit-reset', 'x-ratelimit-remaining']) {
    const v = res.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}

function upstreamKey(req: Request): string | undefined {
  const xkey = req.headers.get('x-api-key');
  if (xkey) return xkey;
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return undefined;
}

function estimateInputTokens(req: AnthropicMessagesRequest): number {
  const sys = typeof req.system === 'string' ? req.system : JSON.stringify(req.system ?? '');
  const body = JSON.stringify(req.messages ?? []);
  return Math.max(1, Math.ceil((sys.length + body.length) / 4));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;

  // slug = [providerId, base64url(upstream), 'v1', 'messages', ...]
  const v1 = slug.indexOf('v1');
  if (v1 < 2) return anthropicError(404, 'Unknown shim path');
  const encodedUpstream = slug[v1 - 1];
  const anthropicPath = slug.slice(v1).join('/');

  let upstreamBase: string;
  try {
    upstreamBase = Buffer.from(encodedUpstream, 'base64url').toString('utf8');
    const u = new URL(upstreamBase);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return anthropicError(400, 'Unsupported upstream protocol');
    }
  } catch {
    return anthropicError(400, 'Malformed upstream target');
  }

  let body: AnthropicMessagesRequest;
  try {
    body = (await request.json()) as AnthropicMessagesRequest;
  } catch {
    return anthropicError(400, 'Invalid JSON body');
  }

  // count_tokens: the SDK may ask before generating. Estimate — the shim can't
  // reach the upstream tokenizer, and correctness of generation doesn't depend on it.
  if (anthropicPath.endsWith('count_tokens')) {
    return Response.json({ input_tokens: estimateInputTokens(body) });
  }

  const key = upstreamKey(request);
  const target = `${upstreamBase.replace(/\/$/, '')}/chat/completions`;
  const oaReq = anthropicToOpenAI(body, body.model);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(oaReq),
    });
  } catch (err) {
    return anthropicError(502, `Upstream request failed: ${err instanceof Error ? err.message : 'unknown'}`, 'api_error');
  }

  if (!upstreamRes.ok) {
    const detail = await upstreamRes.text().catch(() => '');
    /**
     * Log it, because the response body goes to the SDK subprocess and nowhere
     * a human looks.
     *
     * Without this line the only visible symptom of a failing provider was a
     * tool that appeared to hang: the SDK posts the tool RESULT back here, gets
     * a 502, retries, and the turn never advances — so the last tool sits at
     * `running` in the UI and the per-tool watchdog eventually reports it as
     * hung. A user watching that sees "search is broken". Search was fine; the
     * model call after it was not, and the reason was in a string nobody read.
     */
    console.error(
      `[llm-proxy] upstream ${upstreamRes.status} for model=${body.model}: ${detail.slice(0, 500)}`,
    );
    return anthropicError(
      callerStatusFor(upstreamRes.status),
      `Upstream error ${upstreamRes.status}: ${detail.slice(0, 500)}`,
      // The Anthropic error taxonomy the SDK switches on. A rate limit named as
      // an `api_error` is retried on the wrong schedule, if at all.
      upstreamRes.status === 429 ? 'rate_limit_error' : 'api_error',
      retryHeaders(upstreamRes),
    );
  }

  // Non-streaming: translate the single JSON response.
  if (!body.stream) {
    const data = await upstreamRes.json().catch(() => ({}));
    return Response.json(openAIToAnthropic(data, body.model));
  }

  // Streaming: OpenAI SSE → Anthropic SSE.
  if (!upstreamRes.body) return anthropicError(502, 'Upstream returned no stream body', 'api_error');
  const messageId = `msg_${globalThis.crypto.randomUUID()}`;
  const inputTokens = estimateInputTokens(body);
  const encoder = new TextEncoder();
  const oaChunks = parseOpenAISSE(upstreamRes.body as unknown as AsyncIterable<Uint8Array>);
  const events = translateStream(oaChunks, { messageId, model: body.model, inputTokens });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const evt of events) controller.enqueue(encoder.encode(serializeSSE(evt)));
      } catch {
        // stream aborted / upstream hiccup — close what we have
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
