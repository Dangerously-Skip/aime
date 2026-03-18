export const runtime = 'nodejs';

export async function GET() {
  const publicKey = process.env.NANGO_PUBLIC_KEY || '';
  const serverUrl = process.env.NANGO_SERVER_URL || '';
  const configured = !!(publicKey && serverUrl && process.env.NANGO_SECRET_KEY);

  return Response.json({ publicKey, serverUrl, configured });
}
