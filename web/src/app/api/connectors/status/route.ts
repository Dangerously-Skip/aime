export const runtime = 'nodejs';

import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';

/**
 * GET /api/connectors/status
 * Returns the connector catalog with status info.
 * Replaces the old /api/nango/status endpoint.
 */
export async function GET() {
  // Return all connectors from the registry
  // Client-side store manages auth/enabled state
  const connectors = CONNECTOR_REGISTRY.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.category,
    icon: '',
    authType: c.auth.type,
    connected: false, // Client-side store determines this
  }));

  return Response.json({ connectors });
}
