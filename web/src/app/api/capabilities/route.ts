import { NextRequest } from 'next/server';
import { runCapability, CapabilityError, type CapabilityKind } from '@/lib/models/capabilities';
import type { Transport } from '@/lib/models/providers';

export const runtime = 'nodejs';

/**
 * One-shot capability call (image / mesh3d / embedding) against a user-added
 * provider, made outside the agent loop. The client resolves the model +
 * provider from its store and sends a non-secret descriptor; the key is read
 * from the keychain by providerId (a transient request key still wins).
 *
 * POST /api/capabilities
 *   { capability, providerConfig:{ providerId, transport, baseUrl }, model,
 *     prompt?, input?, size?, n?, apiKey? }
 */
interface Body {
  capability?: CapabilityKind;
  model?: string;
  apiKey?: string;
  providerConfig?: { providerId?: string; transport?: Transport; baseUrl?: string };
  prompt?: string;
  input?: string | string[];
  size?: string;
  n?: number;
}

const CAPS: CapabilityKind[] = ['image', 'mesh3d', 'embedding'];

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.capability || !CAPS.includes(body.capability)) {
    return Response.json({ error: 'capability must be one of image | mesh3d | embedding' }, { status: 400 });
  }
  if (!body.model) return Response.json({ error: 'model is required' }, { status: 400 });
  const transport = body.providerConfig?.transport;
  if (!transport) return Response.json({ error: 'providerConfig.transport is required' }, { status: 400 });

  // Resolve the key: transient request key, else keychain by providerId.
  let apiKey = body.apiKey || undefined;
  if (!apiKey && body.providerConfig?.providerId) {
    try {
      const { getCredentialStore } = await import('@/lib/models/credentials');
      apiKey = await getCredentialStore().getField(body.providerConfig.providerId, 'apiKey');
    } catch {
      // CredentialStoreUnavailable / read error → fall back to none.
    }
  }

  try {
    const result = await runCapability({
      capability: body.capability,
      transport,
      model: body.model,
      baseUrl: body.providerConfig?.baseUrl,
      apiKey,
      prompt: body.prompt,
      input: body.input,
      size: body.size,
      n: body.n,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof CapabilityError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: 'Capability call failed' }, { status: 502 });
  }
}
