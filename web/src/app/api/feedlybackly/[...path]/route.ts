export const runtime = 'nodejs';

// No /api/v1 here — the widget appends that itself to whatever apiUrl is set to.
const FEEDLYBACKLY_BASE = 'https://feedlybackly-api.apps.dangerouslyskip.com';
// Was a literal here. That put a live credential in 575 commits, and this repo is
// going public. Unset is not an error worth crashing a build over — it is what a
// fork looks like — so the route refuses at request time instead.
const FEEDLYBACKLY_API_KEY = process.env.FEEDLYBACKLY_API_KEY;

// Headers that must not be forwarded to upstream (hop-by-hop)
const HOP_BY_HOP = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate', 'upgrade']);

/**
 * Proxy for FeedlyBackly API to avoid CORS issues in dev/Electron.
 * Forwards all requests to the upstream API server-to-server.
 */
async function proxy(req: Request, path: string[]): Promise<Response> {
  if (!FEEDLYBACKLY_API_KEY) {
    return new Response(JSON.stringify({ error: 'Feedback is not configured on this build.' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  const upstream = `${FEEDLYBACKLY_BASE}/${path.join('/')}`;
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const url = qs ? `${upstream}?${qs}` : upstream;

  // Forward all safe headers from the widget, then inject the API key
  const forwardHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });
  forwardHeaders['x-api-key'] = FEEDLYBACKLY_API_KEY;
  // Override origin to match what the widget normally sends — the API does a
  // server-side CORS check and rejects requests from unknown origins.
  forwardHeaders['origin'] = 'https://feedlybackly-widget.apps.dangerouslyskip.com';
  forwardHeaders['referer'] = 'https://feedlybackly-widget.apps.dangerouslyskip.com/';

  const init: RequestInit = {
    method: req.method,
    headers: forwardHeaders,
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.text();
  }

  console.log(`[FeedlyBackly Proxy] ${req.method} ${url}`);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[FeedlyBackly Proxy] Fetch failed: ${msg}`);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 502,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  }

  const body = await res.text();
  console.log(`[FeedlyBackly Proxy] Response ${res.status}: ${body.slice(0, 200)}`);

  return new Response(body, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || 'application/json',
      'access-control-allow-origin': '*',
    },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}
export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}
export async function PUT(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}
export async function DELETE(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
