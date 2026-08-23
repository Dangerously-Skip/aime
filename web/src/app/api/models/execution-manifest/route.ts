import { NextRequest } from 'next/server';
import { isCrossOriginRequest } from '@/lib/security/same-origin';
import { buildManifest, parseManifest } from '@/lib/models/execution-manifest';
import { readExecutionManifest, writeExecutionManifest } from '@/lib/models/execution-manifest-fs';

/**
 * Publish the tier grid's decision so headless work can obey it.
 *
 * WHY A ROUTE AT ALL. The decision is made client-side — `resolveSendRoute` needs
 * the provider store and the tier grid, both of which live in the renderer — and
 * the process that needs it has no request to carry it. The widget scheduler
 * ticks inside the Next server precisely so a refresh works "with no window at
 * all", which is exactly why it cannot ask the window anything.
 *
 * WHAT IT ACCEPTS. Resolved routes and nothing else: a capability, a tier, a
 * model, and the non-secret provider config needed to execute. Credentials are
 * already server-side in an encrypted store keyed by provider id; this carries
 * the SELECTION, and `buildManifest` strips secret-shaped fields regardless of
 * what a caller sends.
 *
 * SAME-ORIGIN ONLY. This decides which model an unattended agent runs on, and
 * the API is unauthenticated on loopback — so any page in any tab could
 * otherwise repoint scheduled work at a model of its choosing.
 */

export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { routes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.routes)) {
    return Response.json({ error: 'routes must be an array' }, { status: 400 });
  }

  const entries = body.routes
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      capability: String(r.capability ?? ''),
      tier: String(r.tier ?? ''),
      model: typeof r.model === 'string' ? r.model : null,
      providerConfig: r.providerConfig,
    }))
    .filter((r) => r.capability && r.tier);

  const manifest = buildManifest(entries, new Date().toISOString());

  /*
   * An empty manifest is refused rather than written.
   *
   * A client that resolves nothing — mid-hydration, or with no providers yet —
   * would otherwise ERASE a good manifest and take scheduled work offline until
   * the next settings change. Absent and empty must not be reachable by
   * accident; clearing is a deliberate act (DELETE), not a side effect of a
   * badly-timed save.
   */
  if (Object.keys(manifest.routes).length === 0) {
    return Response.json(
      { ok: false, skipped: 'no resolvable routes — the existing manifest was left alone' },
      { status: 200 },
    );
  }

  try {
    await writeExecutionManifest(manifest);
  } catch (e) {
    return Response.json(
      { error: `Could not write the manifest: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, routes: Object.keys(manifest.routes).length });
}

/** What the server currently believes. For Settings to show, and for debugging. */
export async function GET(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const manifest = await readExecutionManifest();
  return Response.json({
    // `parseManifest` again on the way out: a file edited by hand is the one
    // input this route has no control over.
    manifest: manifest ? parseManifest(manifest) : null,
  });
}
