import { NextResponse, type NextRequest } from 'next/server';
import { configuredToken, decide, sessionCookie, TOKEN_PARAM } from '@/lib/auth/local-token';

/**
 * Authenticates the local API.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy` — same
 * hook, clearer name, because it sits at a network boundary in front of the
 * app. Using the old name still works and prints a deprecation warning on every
 * dev boot. See `lib/auth/local-token.ts` for why this
 * exists and why it is a cookie rather than a header.
 *
 * Two kinds of path pass through here:
 *
 *   `/api/*`  — requires a credential. This is the whole point.
 *   page routes — allowed through unauthenticated, because the HTML shell holds
 *                 no data; everything it renders arrives over `/api`. What page
 *                 routes DO get is the `?t=` exchange, since that is how the
 *                 Electron window turns the launch token into a session before
 *                 the app makes its first API call.
 *
 * The redirect after minting the cookie is not cosmetic: it strips the token
 * from the URL so it does not sit in `window.location`, get copied out of the
 * address bar, or ride along in a `Referer`.
 */
export function proxy(req: NextRequest) {
  const token = configuredToken(process.env as Record<string, string | undefined>);
  const { pathname, searchParams } = req.nextUrl;
  const isApi = pathname.startsWith('/api/');

  const verdict = decide(
    {
      pathname,
      origin: req.headers.get('origin'),
      host: req.headers.get('host'),
      cookie: req.headers.get('cookie'),
      authorization: req.headers.get('authorization'),
      tokenParam: searchParams.get(TOKEN_PARAM),
    },
    token,
  );

  if (verdict.ok && verdict.setCookie) {
    const stripped = req.nextUrl.clone();
    stripped.searchParams.delete(TOKEN_PARAM);
    const res = NextResponse.redirect(stripped);
    res.headers.set('set-cookie', sessionCookie(verdict.token));
    return res;
  }

  // A page route needs no credential — only the API does.
  if (!isApi) return NextResponse.next();

  if (verdict.ok) return NextResponse.next();

  return new NextResponse(JSON.stringify({ error: verdict.reason }), {
    status: verdict.status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Everything except Next's own asset routes and the favicon.
 *
 * Deliberately NOT `/api/:path*`. The matcher has to include page routes too,
 * or the `?t=` exchange never runs and the app can never obtain a session.
 * `api-auth-coverage.test.ts` asserts every route under `app/api` is matched by
 * this pattern, so a new route cannot quietly land outside it.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
