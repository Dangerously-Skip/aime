import { NextRequest } from 'next/server';
import { getPreset, needsApiKey } from '@/lib/models/providers';
import { scanModels, ScanError } from '@/lib/models/scan';

export const runtime = 'nodejs';

/**
 * POST /api/models/scan
 * Body: { presetId, apiKey?, baseUrl?, providerId? }
 *
 * Lists a provider's models. A transient `apiKey` is accepted for the
 * "add provider → test & scan" flow (used to call the provider, never logged,
 * never persisted here). For a *rescan* of an already-added provider the client
 * no longer holds the key, so `providerId` lets the server read it back from
 * the keychain. Neither path persists the key — persistence is the credential
 * store's job.
 */
export async function POST(req: NextRequest) {
  let body: { presetId?: string; apiKey?: string; baseUrl?: string; providerId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { presetId, baseUrl, providerId } = body;
  let apiKey = body.apiKey;
  if (!presetId || typeof presetId !== 'string') {
    return Response.json({ error: 'presetId is required' }, { status: 400 });
  }

  const preset = getPreset(presetId);
  if (!preset) {
    return Response.json({ error: `Unknown provider: ${presetId}` }, { status: 400 });
  }
  if (!preset.scan) {
    return Response.json(
      { error: `${preset.label} does not support model discovery — enter models manually` },
      { status: 422 },
    );
  }

  // Rescan fallback: no transient key but a known provider id → read the stored
  // key from the keychain. Best-effort; unavailability falls through to the
  // needs-key check below with a clear error.
  if (!apiKey && providerId) {
    try {
      const { getCredentialStore } = await import('@/lib/models/credentials');
      apiKey = await getCredentialStore().getField(providerId, 'apiKey');
    } catch {
      // CredentialStoreUnavailable / read error → treat as no key.
    }
  }

  if (needsApiKey(preset) && !apiKey) {
    return Response.json({ error: `${preset.label} requires an API key` }, { status: 400 });
  }

  try {
    const models = await scanModels(preset, { apiKey, baseUrl });
    return Response.json({ models });
  } catch (err) {
    if (err instanceof ScanError) {
      const status = err.code === 'no-key' ? 400 : err.code === 'unsupported' ? 422 : 502;
      return Response.json({ error: err.message, code: err.code }, { status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
