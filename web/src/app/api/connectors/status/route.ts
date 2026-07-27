export const runtime = 'nodejs';

import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';
import { classifyCatalog } from '@/lib/connectors/connectability';

/**
 * GET /api/connectors/status
 *
 * The connector catalogue, ordered so the services that connect in one click
 * come first, each annotated with how much work connecting actually involves.
 *
 * This has to happen server-side: whether an OAuth app is configured depends on
 * env vars the renderer cannot see, so without it the UI can only discover a
 * dead end by letting the user click and fail. Only variable *names* are
 * returned, never credential values.
 *
 * Whether a connector is currently authenticated remains client state (the
 * tokens live in the connector store), so `connected` is reported as false here
 * and the store overrides it — kept in the payload for existing callers.
 */
export async function GET() {
  const connectors = classifyCatalog(CONNECTOR_REGISTRY).map((c) => ({
    ...c,
    icon: '',
    connected: false, // Client-side store determines this
  }));

  return Response.json({ connectors });
}
