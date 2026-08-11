import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { resolveWithinTree } from '@/lib/path-containment';

export const runtime = 'nodejs';

/**
 * Serve an image that sits next to a generated deck.
 *
 * WHY. `CreateImage` writes into `<deck dir>/images/`, and `themeInstruction`
 * tells the model to embed it as `src="images/x.png"` — correct for a file
 * opened from disk, and wrong in the in-app preview, where the deck is the
 * `srcDoc` of an iframe whose base URL is the app origin. Every one of those
 * requests went to `http://localhost:PORT/images/x.png` and 404'd, so a themed
 * deck with generated art showed a broken image in every slot. That is the
 * "there were no images in the generated slide deck" report, and only half of
 * it was a generation problem.
 *
 * `/api/themes/asset` could not do this: it serves the VENDORED html-deck
 * assets out of a fixed directory, and these files live wherever the deck was
 * written.
 *
 * WHY THIS IS NOT A FILE-READ PRIMITIVE. Two locks, both checked after
 * resolution rather than by stripping characters:
 *
 *   1. the target must land inside the DECK'S OWN directory, so `file` cannot
 *      climb out however it is encoded;
 *   2. the extension must be on the image allowlist.
 *
 * Which makes it strictly narrower than `/api/files/read`, which the viewer
 * already uses to load the deck itself.
 */
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

export async function GET(req: NextRequest) {
  const deck = req.nextUrl.searchParams.get('deck') ?? '';
  const file = req.nextUrl.searchParams.get('file') ?? '';
  if (!deck || !file) {
    return NextResponse.json({ error: 'deck and file are required' }, { status: 400 });
  }

  const contained = resolveWithinTree(path.dirname(path.resolve(deck)), file);
  if (!contained.ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ext = path.extname(contained.path).toLowerCase();
  const type = TYPES[ext];
  if (!type) {
    return NextResponse.json({ error: 'Not an image' }, { status: 404 });
  }

  let body: Buffer;
  try {
    // No `statSync` guard for directories: `readFileSync` throws EISDIR and
    // lands in the same catch. A separate check read as load-bearing and was
    // not — removing it broke no test, which is how it was noticed.
    body = fs.readFileSync(contained.path);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': type,
      // The file is rewritten in place when a deck is regenerated, and the
      // preview is reopened constantly while iterating on one.
      'Cache-Control': 'no-store',
    },
  });
}
