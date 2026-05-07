import { getAvailableProviders } from '@/lib/providers';
import { getLogger } from '@/lib/logger';
import { withRequestContext } from '@/middleware/correlation';

export const runtime = 'nodejs';

/**
 * Health check endpoint.
 * GET /api/health
 */
export const GET = withRequestContext(async () => {
  getLogger().info({ event: 'api.health' }, 'health check');
  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: getAvailableProviders(),
  });
});
