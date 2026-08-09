import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';

/**
 * Serve a vendored html-deck stylesheet to the theme previews.
 *
 * The previews render in an iframe against the REAL `base.css` and the REAL
 * theme file, because the first version reimplemented a slide in React using a
 * handful of tokens and quietly discarded everything that makes these themes
 * distinct — `--grad` and `--shadow` in particular, which are the whole
 * character of neo-brutalism's hard offset shadow and cyberpunk-neon's glow.
 * Thirty-six designs rendered as one layout in different colours, which is
 * exactly the "boring and samey" it was reported as.
 *
 * Path handling is a containment check rather than a sanitiser: resolve, then
 * verify the result is still inside the assets directory. Stripping `..` is the
 * approach that keeps being defeated by encodings.
 */
const ASSETS = path.resolve(process.cwd(), 'resources/html-deck/assets');

/**
 * `.js` is served as well as `.css` so the in-app deck viewer gets `runtime.js`
 * — keyboard navigation, presenter mode and the overview grid. Without it the
 * preview renders slide one and nothing responds, which reads as broken rather
 * than as a still image.
 *
 * The allowlist stays an allowlist. It is what stops this becoming a general
 * file-read endpoint, and it is checked AFTER resolution, so an encoded
 * traversal that lands outside `ASSETS` fails on containment first.
 */
const TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get('file') ?? '';
  const resolved = path.resolve(ASSETS, rel);
  const contentType = TYPES[path.extname(resolved)];

  if (!resolved.startsWith(ASSETS + path.sep) || !contentType) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!fs.existsSync(resolved)) return new NextResponse('Not found', { status: 404 });

  return new NextResponse(fs.readFileSync(resolved, 'utf-8'), {
    headers: {
      'Content-Type': contentType,
      // Vendored files change only when the app updates.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
