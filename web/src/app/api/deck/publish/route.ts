import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { bundleDeck, exportFileName } from '@/lib/deck-export';
import { isCrossOriginRequest } from '@/lib/security/same-origin';
import { readableFrom } from '../export/route';
import { googleDriveTarget } from '@/lib/publish/google-drive';
import { s3Target, type S3Config } from '@/lib/publish/s3-storage';
import { connectorAccessToken } from '@/lib/publish/connector-token';
import { PublishError, type Audience } from '@/lib/publish/types';
import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';
import { getMcpSecretStore } from '@/lib/mcp/secret-store';

export const runtime = 'nodejs';

/**
 * Publish a deck to storage the user has already connected.
 *
 * Deliberately NOT an agent tool. Publishing is irreversible in the way that
 * matters — you cannot un-send a URL — and the decks this app produces are
 * built from the user's mail, calendar and files. A prompt-injected page that
 * could reach a `Publish` tool is this session's SSRF work with no undo. So it
 * is a user action from the UI, same-origin only, one deck at a time.
 */
const TARGETS = ['google-drive', 's3'] as const;
type TargetId = (typeof TARGETS)[number];

/** The connectors that can back a Drive publish, in preference order. */
const GOOGLE_CONNECTORS = ['google-workspace', 'google-personal'];

function parseAudience(raw: unknown): Audience | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as { kind?: unknown; emails?: unknown };
  if (a.kind === 'link') return { kind: 'link' };
  if (a.kind === 'people') {
    const emails = Array.isArray(a.emails) ? a.emails.filter((e) => typeof e === 'string') : [];
    return { kind: 'people', emails };
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (isCrossOriginRequest(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { path?: string; target?: string; audience?: unknown; storage?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const deckPath = typeof body.path === 'string' ? body.path.trim() : '';
  const targetId = body.target as TargetId;
  const audience = parseAudience(body.audience);

  if (!deckPath) return NextResponse.json({ error: 'path is required' }, { status: 400 });
  if (!TARGETS.includes(targetId)) return NextResponse.json({ error: 'unknown_target' }, { status: 400 });
  if (!audience) return NextResponse.json({ error: 'audience is required' }, { status: 400 });

  let html: string;
  try {
    html = fs.readFileSync(path.resolve(deckPath), 'utf-8');
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // The same bundle the Export button produces — a published deck that
  // depended on the author's filesystem would be broken for every viewer.
  const deckDir = path.dirname(path.resolve(deckPath));
  const bundled = bundleDeck(html, path.resolve(deckPath), {
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

  const store = getMcpSecretStore();
  const deps = { read: (key: string) => store.get(key.replace(/^mcp:/, '')) };

  let accessToken: string | null = null;
  let label = 'Google Drive';
  for (const id of targetId === 'google-drive' ? GOOGLE_CONNECTORS : []) {
    const connector = CONNECTOR_REGISTRY.find((c) => c.id === id);
    if (!connector) continue;
    accessToken = await connectorAccessToken(connector, deps);
    if (accessToken) {
      label = `Google Drive (${connector.name})`;
      break;
    }
  }

  /*
   * The bucket's credentials come from the REQUEST because the renderer holds
   * settings — same as the search instance URL. `s3Target` validates the
   * endpoint through the same guard for the same reason: a LAN MinIO is a real
   * setup, link-local is cloud metadata.
   */
  const target =
    targetId === 's3'
      ? s3Target({ config: (body.storage ?? {}) as S3Config })
      : googleDriveTarget({ accessToken: accessToken ?? '', label });

  try {
    const result = await target.publish({
      fileName: exportFileName(deckPath),
      html: bundled.html,
      audience,
    });
    return NextResponse.json({ ...result, missing: bundled.missing, remoteFonts: bundled.remoteFonts });
  } catch (e) {
    if (e instanceof PublishError) {
      const status = e.code === 'not-connected' ? 409
        : e.code === 'auth' ? 401
        : e.code === 'invalid-recipient' || e.code === 'unsupported-audience' ? 400
        : 502;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    return NextResponse.json({ error: 'upstream', message: 'Publish failed' }, { status: 502 });
  }
}
