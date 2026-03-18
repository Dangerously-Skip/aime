import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const publicKey = process.env.NANGO_PUBLIC_KEY;
  const serverUrl = process.env.NANGO_SERVER_URL;

  if (!publicKey || !serverUrl) {
    return Response.json({ error: 'Nango is not configured' }, { status: 503 });
  }

  let body: { integrationId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { integrationId } = body;
  if (!integrationId) {
    return Response.json({ error: 'integrationId is required' }, { status: 400 });
  }

  const connectionId = `user-${integrationId}-${Date.now()}`;

  return Response.json({
    integrationId,
    connectionId,
    nangoPublicKey: publicKey,
    nangoServerUrl: serverUrl,
  });
}
