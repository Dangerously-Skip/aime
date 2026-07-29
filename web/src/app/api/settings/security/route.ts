import { NextRequest } from 'next/server';
import { loadSecuritySettings, saveSecuritySettings } from '@/lib/security/settings';

export const runtime = 'nodejs';

/**
 * The user's security toggles, server-side.
 *
 * GET  /api/settings/security → SecuritySettings
 * POST /api/settings/security { …toggles } → the stored result
 *
 * These used to ride on each chat request, which meant most callers never sent
 * them and omitting the field disabled the control. The server owns them now;
 * see lib/security/settings.ts for the full reasoning.
 *
 * No secrets pass through here — booleans only — and POST coerces field by
 * field, so an unknown or malformed body cannot turn a protection off by
 * accident.
 */
export async function GET() {
  return Response.json(await loadSecuritySettings());
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return Response.json(await saveSecuritySettings(body));
}
