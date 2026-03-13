export const runtime = 'nodejs';

/**
 * POST /api/settings/composio/reset
 * Clears all cached Composio sessions so they'll be re-initialized on next use.
 */
export async function POST() {
  if (globalThis.__composioSessions) {
    const count = globalThis.__composioSessions.size;
    globalThis.__composioSessions.clear();
    console.log('[COMPOSIO] Reset: cleared', count, 'cached sessions');
    return Response.json({ success: true, clearedSessions: count });
  }

  return Response.json({ success: true, clearedSessions: 0 });
}
