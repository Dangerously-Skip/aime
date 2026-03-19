import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

/**
 * GET /api/webhooks — List webhook configs (stored server-side in globalThis for now)
 * POST /api/webhooks — Create a webhook config
 * DELETE /api/webhooks — Delete a webhook config by id
 */

export interface WebhookConfig {
  id: string;
  token: string;
  name: string;
  targetSurface: string;
  systemPrompt: string;
  enabled: boolean;
  createdAt: number;
}

// Singleton in-process store (survives hot reload via globalThis)
declare global {
  // eslint-disable-next-line no-var
  var __webhookConfigs: Map<string, WebhookConfig> | undefined;
}
function getWebhookStore(): Map<string, WebhookConfig> {
  if (!globalThis.__webhookConfigs) {
    globalThis.__webhookConfigs = new Map();
  }
  return globalThis.__webhookConfigs;
}

export async function GET() {
  const store = getWebhookStore();
  return Response.json({ webhooks: Array.from(store.values()) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      name?: string;
      targetSurface?: string;
      systemPrompt?: string;
    };

    const { name, targetSurface = 'cowork', systemPrompt = '' } = body;
    if (!name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const config: WebhookConfig = {
      id: randomUUID(),
      token: randomUUID(),
      name,
      targetSurface,
      systemPrompt,
      enabled: true,
      createdAt: Date.now(),
    };

    getWebhookStore().set(config.id, config);
    return Response.json({ webhook: config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json() as { id?: string };
    if (!id) {
      return Response.json({ error: 'id is required' }, { status: 400 });
    }
    getWebhookStore().delete(id);
    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
