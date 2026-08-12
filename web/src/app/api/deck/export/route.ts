import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { bundleDeck, exportFileName, leaksLocalPaths } from '@/lib/deck-export';
import { isCrossOriginRequest } from '@/lib/security/same-origin';

export const runtime = 'nodejs';

/**
 * Bundle a deck into one self-contained file the user can send someone.
 *
 * This reads whatever the deck references, driven by a caller-supplied path, so
 * it gets the same locks as `/api/deck/asset`: a same-origin check — the app
 * ships a browser surface, and a page the user is viewing must not be able to
 * drive local file reads — and containment to the deck's own directory.
 *
 * The vendored html-deck assets are the deliberate exception: they live under
 * `~/.claude/plugins/<plugin>/assets` rather than beside the deck, and the
 * generator links them by absolute path. That shape is allowlisted explicitly,
 * which is narrower than "any absolute path the HTML asks for" — the HTML is
 * model-authored, so that distinction is the whole point.
 */
const PLUGIN_ASSETS = /[\\/]\.claude[\\/]plugins[\\/][^\\/]+[\\/]assets[\\/]/;

export function readableFrom(deckDir: string, target: string): boolean {
  const resolved = path.resolve(target);
  const rel = path.relative(path.resolve(deckDir), resolved);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
  return PLUGIN_ASSETS.test(resolved);
}

export async function POST(req: NextRequest) {
  if (isCrossOriginRequest(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const deckPath = typeof body.path === 'string' ? body.path.trim() : '';
  if (!deckPath) return NextResponse.json({ error: 'path is required' }, { status: 400 });

  let html: string;
  try {
    html = fs.readFileSync(path.resolve(deckPath), 'utf-8');
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const deckDir = path.dirname(path.resolve(deckPath));
  const result = bundleDeck(html, path.resolve(deckPath), {
    resolve: (dir, ref) => (path.isAbsolute(ref) ? ref : path.resolve(dir, ref)),
    readText: (p) => {
      if (!readableFrom(deckDir, p)) return null;
      try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
    },
    readBinary: (p) => {
      if (!readableFrom(deckDir, p)) return null;
      try { return new Uint8Array(fs.readFileSync(p)); } catch { return null; }
    },
  });

  return NextResponse.json({
    fileName: exportFileName(deckPath),
    html: result.html,
    inlined: result.inlined,
    missing: result.missing,
    remoteFonts: result.remoteFonts,
    // Surfaced, not merely logged: an export that still names the author's
    // machine is one they are about to send to somebody else.
    leaks: leaksLocalPaths(result.html),
  });
}
