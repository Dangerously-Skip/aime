import { getAvailableProviders } from '@/lib/providers';

export const runtime = 'nodejs';

/**
 * Health check endpoint.
 * GET /api/health
 */
export async function GET() {
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: getAvailableProviders(),
  });
}
