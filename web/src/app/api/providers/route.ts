import { getAvailableProviders } from '@/lib/providers';

export const runtime = 'nodejs';

/**
 * List available providers.
 * GET /api/providers
 */
export async function GET() {
  return Response.json({
    providers: getAvailableProviders(),
    default: 'claude',
  });
}
