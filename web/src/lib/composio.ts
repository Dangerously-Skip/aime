import { Composio } from '@composio/core';

// Extend globalThis for singleton caching to survive Next.js hot reload
declare global {
  // eslint-disable-next-line no-var
  var __composio: Composio | undefined;
  // eslint-disable-next-line no-var
  var __composioSessions: Map<string, ComposioSession> | undefined;
}

/**
 * Shape of a Composio session returned by composio.create().
 */
export interface ComposioSession {
  mcp: {
    url: string;
    headers: Record<string, string>;
  };
  [key: string]: unknown;
}

/**
 * Get the global Composio singleton instance.
 * Uses globalThis caching so the instance survives Next.js hot reloads in dev.
 */
export function getComposio(): Composio {
  if (!globalThis.__composio) {
    globalThis.__composio = new Composio();
  }
  return globalThis.__composio;
}

/**
 * Get the global sessions cache.
 */
function getSessionsCache(): Map<string, ComposioSession> {
  if (!globalThis.__composioSessions) {
    globalThis.__composioSessions = new Map();
  }
  return globalThis.__composioSessions;
}

/**
 * Get or create a Composio session for the given userId.
 * Sessions are cached on globalThis to survive hot reloads.
 */
export async function getOrCreateComposioSession(userId: string = 'default-user'): Promise<ComposioSession> {
  const sessions = getSessionsCache();

  const cached = sessions.get(userId);
  if (cached) {
    return cached;
  }

  console.log('[COMPOSIO] Creating new session for user:', userId);
  const composio = getComposio();
  const session = await composio.create(userId) as unknown as ComposioSession;
  sessions.set(userId, session);
  console.log('[COMPOSIO] Session created with MCP URL:', session.mcp.url);

  return session;
}

/**
 * Build MCP servers config object from a Composio session.
 * Returns the shape expected by providers.
 */
export function buildComposioMcpServers(session: ComposioSession): Record<string, unknown> {
  return {
    composio: {
      type: 'http',
      url: session.mcp.url,
      headers: session.mcp.headers,
    },
  };
}
