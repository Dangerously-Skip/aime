import { NextRequest } from 'next/server';
import { Nango } from '@nangohq/node';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secretKey = process.env.NANGO_SECRET_KEY;
  const serverUrl = process.env.NANGO_SERVER_URL;

  if (!secretKey || !serverUrl) {
    return Response.json({ error: 'Nango is not configured' }, { status: 503 });
  }

  let body: { integrationId?: string; connectionId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { integrationId, connectionId } = body;
  if (!integrationId || !connectionId) {
    return Response.json({ error: 'integrationId and connectionId are required' }, { status: 400 });
  }

  const nango = new Nango({ secretKey, host: serverUrl });

  try {
    await nango.deleteConnection(integrationId, connectionId);
    return Response.json({ success: true });
  } catch (err) {
    console.error('[Nango] Error disconnecting:', err);
    return Response.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
