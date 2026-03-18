import { NextRequest } from 'next/server';
import type { WebhookConfig } from '../route';

declare global {
  // eslint-disable-next-line no-var
  var __webhookConfigs: Map<string, WebhookConfig> | undefined;
}

export const runtime = 'nodejs';

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
      ...(config.systemPrompt ? { projectInstructions: config.systemPrompt } : {}),
    }),
  }).catch((err) => console.error('[Webhook] Agent run failed:', err));

  // Don't await — return immediately with the chatId
  void runPromise;

  return Response.json({
    ok: true,
    chatId,
    webhookId: config.id,
    surface: config.targetSurface,
  });
}
