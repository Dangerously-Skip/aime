import { NextRequest } from 'next/server';
import type { WebhookConfig } from '../route';

declare global {
  // eslint-disable-next-line no-var
  var __webhookConfigs: Map<string, WebhookConfig> | undefined;
}

export const runtime = 'nodejs';

/**
 * Read a response body to completion and discard it.
 *
 * Not `body.cancel()`: cancelling propagates back through the chat route's
 * TransformStream and would abort the agent run we just started. Not "ignore it"
 * either — that was the previous behaviour, and it leaves the producer pushing
 * into a stream with no consumer.
 */
async function drain(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  try {
    let done = false;
    while (!done) ({ done } = await reader.read());
  } finally {
    reader.releaseLock();
  }
}

/**
 * POST /api/webhooks/:token
 * Validates the token and triggers an agent run with the POST body as context.
 * The response is a JSON object with a chatId that the client can poll.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Find webhook config by token
  const store = globalThis.__webhookConfigs;
  if (!store) {
    return Response.json({ error: 'No webhooks configured' }, { status: 404 });
  }

  const config = Array.from(store.values()).find((w) => w.token === token && w.enabled);
  if (!config) {
    return Response.json({ error: 'Invalid or disabled webhook token' }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    payload = await req.text().catch(() => '');
  }

  const chatId = crypto.randomUUID();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const message = `<webhook-payload source="${config.name}">\n${payloadStr}\n</webhook-payload>\n\nProcess this webhook payload.`;

  // Fire agent run in the background — POST to the chat API
  const baseUrl = req.nextUrl.origin;
  const runPromise = fetch(`${baseUrl}/api/chat/${config.targetSurface}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      chatId,
      userId: 'webhook',
      apiKey: process.env.ANTHROPIC_API_KEY || undefined,
      // There is no window, no renderer and nothing here that reads the SSE
      // events: a `document_print` or `input_request` from this run can never be
      // acted on. Saying so is what makes the agent take the documented fallback
      // (write the HTML, say only the HTML was written) instead of stalling for
      // the full print budget and then reporting a rendering failure that never
      // happened. This is the only caller of this endpoint that misses out —
      // /api/subagent and the standing-order runner pass no relay callbacks at all.
      canRelayToClient: false,
      ...(config.systemPrompt ? { projectInstructions: config.systemPrompt } : {}),
    }),
  })
    // The stream still has to be DRAINED. Abandoning the body leaves the chat
    // route writing into a stream nobody reads; cancelling it would abort the
    // agent run outright. So read to the end and throw the bytes away.
    .then((res) => drain(res.body))
    .catch((err) => console.error('[Webhook] Agent run failed:', err));

  // Don't await — return immediately with the chatId
  void runPromise;

  return Response.json({
    ok: true,
    chatId,
    webhookId: config.id,
    surface: config.targetSurface,
  });
}
