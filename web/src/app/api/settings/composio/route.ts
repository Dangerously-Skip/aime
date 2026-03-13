export const runtime = 'nodejs';

/**
 * GET /api/settings/composio
 * Returns Composio connection status and session info.
 */
export async function GET() {
  const sessions = globalThis.__composioSessions;
  const hasSession = sessions && sessions.size > 0;

  if (!hasSession) {
    return Response.json({
      status: 'disconnected',
      sessionCount: 0,
      sessions: [],
    });
  }

  const sessionList = Array.from(sessions!.entries()).map(([userId, session]) => ({
    userId,
    mcpUrl: session.mcp?.url ? '(connected)' : '(no url)',
    hasHeaders: !!session.mcp?.headers && Object.keys(session.mcp.headers).length > 0,
  }));

  return Response.json({
    status: 'connected',
    sessionCount: sessions!.size,
    sessions: sessionList,
  });
}
