/**
 * Is this request coming from the app's own UI, or from a page that merely
 * knows the app's address?
 *
 * WHY THIS EXISTS. AIME ships a BROWSER SURFACE — it loads arbitrary web pages —
 * and its API listens on localhost with no authentication, because for a desktop
 * app "the caller is the renderer" was true by construction. It stopped being
 * true the moment a page the user is browsing can issue
 * `fetch('http://localhost:3100/api/…', {method:'POST'})`. A `text/plain` POST
 * is a SIMPLE request: no preflight, so CORS never gets a say, and the page does
 * not need to read the response to do damage — for `/api/search-proxy` the
 * distinguishable 401/502/timeout statuses alone make an internal port scanner.
 *
 * WHAT THIS CHECKS. Only positive evidence of a cross-origin caller:
 *
 *   - `Sec-Fetch-Site` says `cross-site` or `same-site` (browsers set this and a
 *     page cannot forge it — it is a forbidden header name)
 *   - an `Origin` header that does not match the request's own host
 *
 * A request with NEITHER header is allowed. That is deliberate: non-browser
 * callers (the Electron main process, a test, curl) send neither, and refusing
 * them would break real paths while adding nothing — a program that can make an
 * arbitrary local HTTP request is not a confused deputy, it is just a program.
 * The attack this closes is specifically "a web page drives the app's API", and
 * a web page always sends at least one of the two.
 *
 * This is a check, not a session: it is worth exactly what the browser's own
 * header integrity is worth, which against a hostile PAGE is a great deal and
 * against a hostile PROGRAM is nothing.
 */
export function isCrossOriginRequest(req: {
  headers: { get(name: string): string | null };
}): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return true;

  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') return false;

  const host = req.headers.get('host');
  if (!host) return false;
  try {
    // Compared on HOST, not full origin: the renderer may reach the server over
    // http while `Origin` reports the same, and a scheme mismatch on localhost
    // is not the thing being defended against.
    return new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    // An Origin that will not parse is not evidence of sameness.
    return true;
  }
}
