import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * POST /api/customize/connectors/test — Test an MCP server connection
 * Body: { type, command?, url?, args?, headers?, env? }
 *
 * Attempts a lightweight connection check:
 * - For HTTP/SSE: HEAD or GET request to the URL
 * - For stdio: verify the command exists on PATH
 */
export async function POST(req: NextRequest) {
  let body: {
    type?: 'stdio' | 'http' | 'sse';
    command?: string;
    url?: string;
    args?: string[];
    headers?: Record<string, string>;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, command, url } = body;

  if (type === 'http' || type === 'sse') {
    if (!url) {
      return Response.json({ error: 'url is required for HTTP/SSE connectors' }, { status: 400 });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        method: 'HEAD',
        headers: body.headers || {},
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return Response.json({
        success: res.ok || res.status < 500,
        status: res.status,
        statusText: res.statusText,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({
        success: false,
        error: msg,
      });
    }
  }

  if (type === 'stdio') {
    if (!command) {
      return Response.json({ error: 'command is required for stdio connectors' }, { status: 400 });
    }

    try {
      const { execSync } = await import('child_process');
      // Check if command exists
      execSync(`which ${command}`, { timeout: 5000 });
      return Response.json({ success: true });
    } catch {
      return Response.json({
        success: false,
        error: `Command '${command}' not found on PATH`,
      });
    }
  }

  return Response.json({ error: 'type must be stdio, http, or sse' }, { status: 400 });
}
