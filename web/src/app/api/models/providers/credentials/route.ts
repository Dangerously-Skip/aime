import { NextRequest } from 'next/server';
import { getCredentialStore, CredentialStoreUnavailable } from '@/lib/models/credentials';

export const runtime = 'nodejs';

/**
 * Provider credential storage (keychain-backed). Secrets are written to the
 * encrypted store server-side and never returned. GET lists only which
 * providers have credentials, not the values.
 *
 * GET    /api/models/providers/credentials            → { providerIds }
 * POST   /api/models/providers/credentials { providerId, values } → { ok }
 * DELETE /api/models/providers/credentials { providerId }         → { ok }
 */

function unavailable(err: unknown): Response | null {
  if (err instanceof CredentialStoreUnavailable) {
    return Response.json(
      { error: 'Credential storage is unavailable (requires the desktop app).' },
      { status: 503 },
    );
  }
  return null;
}

export async function GET() {
  try {
    const providerIds = await getCredentialStore().list();
    return Response.json({ providerIds });
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { providerId?: string; values?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { providerId, values } = body;
  if (!providerId || typeof providerId !== 'string') {
    return Response.json({ error: 'providerId is required' }, { status: 400 });
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return Response.json({ error: 'values must be an object' }, { status: 400 });
  }
  // Only string values are storable secrets/config.
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string' && v.length > 0) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) {
    return Response.json({ error: 'no non-empty string values provided' }, { status: 400 });
  }

  try {
    await getCredentialStore().set(providerId, clean);
    return Response.json({ ok: true });
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  let body: { providerId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.providerId || typeof body.providerId !== 'string') {
    return Response.json({ error: 'providerId is required' }, { status: 400 });
  }
  try {
    await getCredentialStore().delete(body.providerId);
    return Response.json({ ok: true });
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}
