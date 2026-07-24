import { NextRequest } from 'next/server';
import { getPreset, needsApiKey } from '@/lib/models/providers';
import { scanModels, ScanError } from '@/lib/models/scan';

export const runtime = 'nodejs';

/**
 * POST /api/models/scan
 * Body: { presetId, apiKey?, baseUrl? }
 *
 * Lists a provider's models. The API key is accepted transiently for the
 * "add provider → test & scan" flow (used to call the provider, never logged,
 * never persisted here — persistence is the credential store's job).
 */
export async function POST(req: NextRequest) {
  let body: { presetId?: string; apiKey?: string; baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { presetId, apiKey, baseUrl } = body;
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
